import type { Locator, Page } from 'playwright';
import type { AppConfig } from './config.js';
import type { AccountResult, SandboxAccount } from './types.js';
import { selectors as S } from './selectors.js';
import { log } from './logger.js';
import {
  clickByText,
  clickFirstVisible,
  isVisible,
  screenshotOnError,
} from './playwright-utils.js';
import { humanClick, humanType, think } from './humanize.js';

/** 邮箱已被占用导致创建失败时，错误信息带此前缀，便于上层区分「重复」与「真故障」。 */
export const DUPLICATE_EMAIL = 'DUPLICATE_EMAIL';

/** 判断某个错误信息是否为「邮箱已被占用」。 */
export function isDuplicateEmail(msg: string): boolean {
  return msg.includes(DUPLICATE_EMAIL);
}

/** 从页面文本里抓邮箱用的正则。 */
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/**
 * 步骤 1：确保当前页面是沙盒测试账号列表页。
 * 默认策略是「能不导航就不导航」——你手动开好的页面直接复用，只在当前页明显不对时才 goto。
 * cfg.useOpenPage=true 则连兜底导航也不做。
 */
export async function navigateToSandbox(page: Page, cfg: AppConfig): Promise<void> {
  const t = cfg.stepTimeoutMs;

  if (await isOnSandboxPage(page)) {
    log.ok('当前标签页已在沙盒测试账号列表页，直接复用。');
    return;
  }

  if (cfg.useOpenPage) {
    throw new Error(
      `--use-open-page：当前标签页不是沙盒测试账号页（${page.url()}）。` +
        `请手动打开 ${cfg.sandboxUrl} 后重跑，或去掉 --use-open-page 让工具自动导航。`,
    );
  }

  log.step(`导航到沙盒测试账号页: ${cfg.sandboxUrl}`);
  await page.goto(cfg.sandboxUrl, { waitUntil: 'domcontentloaded', timeout: t });
  await ensureOnSandboxPage(page, t);
  log.ok('已到达沙盒测试账号列表页');
}

/** 页面上是否已能看到列表页的标识文案（不等待，用于快速判断）。 */
async function isOnSandboxPage(page: Page): Promise<boolean> {
  for (const text of S.page.readyTexts) {
    if (await isVisible(page.getByText(text, { exact: false }))) return true;
  }
  return false;
}

/** 等待列表页标识文案出现，超时则报错（附上当前 URL 便于判断是否被踢到登录页）。 */
async function ensureOnSandboxPage(page: Page, timeoutMs: number): Promise<void> {
  for (const text of S.page.readyTexts) {
    const loc = page.getByText(text, { exact: false }).first();
    try {
      await loc.waitFor({ state: 'visible', timeout: timeoutMs });
      return;
    } catch {
      // 换下一个候选文案继续试。
    }
  }
  throw new Error(
    `无法确认已在沙盒测试账号页（未找到「${S.page.readyTexts.join('」/「')}」）。` +
      `当前 URL: ${page.url()}。常见原因是 App Store Connect 未登录或会话已过期，请在浏览器里登录后重跑。`,
  );
}

/**
 * 定位列表标题「Test Accounts (23)」。
 * 只按带数量的形态匹配，以区别于左侧导航栏里的纯「Test Accounts」条目。
 * 找不到时返回 null。
 */
async function resolveHeading(page: Page): Promise<Locator | null> {
  const heading = page.getByText(S.page.countPattern).last();
  return (await isVisible(heading)) ? heading : null;
}

/**
 * 读取标题「Test Accounts (23)」里的账号总数。
 * 用于创建前后对比、确认新账号真的入库了。读不到时返回 null（不影响主流程）。
 */
export async function readAccountCount(page: Page): Promise<number | null> {
  const heading = await resolveHeading(page);
  if (!heading) return null;
  const text = await heading.innerText().catch(() => '');
  const m = S.page.countPattern.exec(text);
  return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * 步骤 2（可选）：预扫描页面上已存在的账号邮箱，供后续去重跳过。
 *
 * 「Viewing X of Y items」里的 Y 就是账号总数，正好用来判断有没有扫全：
 *  - 一次 innerText 就读到 Y 个邮箱（行全在 DOM 里）→ 完全不滚动，页面不会跳；
 *  - 读到的少于 Y（表格是虚拟列表，未进视野的行没渲染）→ 才滚动补齐，凑够 Y 个立刻停。
 * 结束时把滚动位置还原到进来时的样子。
 */
export async function readExistingEmails(page: Page, cfg: AppConfig): Promise<Set<string>> {
  const scrollY = await page.evaluate(() => window.scrollY).catch(() => 0);

  await expandAllRows(page, cfg);
  const total = (await readViewingProgress(page))?.total ?? null;

  // 优先只扫账号表格，避开页面右上角登录者信息等无关文本；没有 table 时退回整页。
  const table = page.getByRole('table');
  const scope = (await isVisible(table)) ? table.first() : page.locator('body');
  const ignored = new Set(S.ignoredEmails.map((e) => e.toLowerCase()));
  const found = new Set<string>();

  const collect = async (): Promise<void> => {
    const text = await scope.innerText().catch(() => '');
    for (const m of text.matchAll(EMAIL_RE)) {
      const email = m[0].toLowerCase();
      if (!ignored.has(email)) found.add(email);
    }
  };

  await collect();

  const scanned = (): boolean => total !== null && found.size >= total;
  if (!scanned()) {
    log.info(
      `首屏只读到 ${found.size}${total === null ? '' : `/${total}`} 个邮箱，` +
        `说明账号表是虚拟列表，滚动补齐剩余行 ...`,
    );
    let stableRounds = 0;
    for (let i = 0; i < 40 && !scanned() && stableRounds < 3; i++) {
      const before = found.size;
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(200);
      await collect();
      stableRounds = found.size === before ? stableRounds + 1 : 0;
    }
  }

  await restoreScroll(page, scrollY);

  log.info(
    `预扫描到页面上已有 ${found.size}${total === null ? '' : `/${total}`} 个沙盒账号邮箱，重复的将自动跳过。`,
  );
  if (total !== null && found.size < total) {
    log.warn(
      `未能扫全账号列表（${found.size}/${total}），未扫到的账号若与本次邮箱重复，` +
        `会在 Create 时被 Apple 判为重复而记为失败。`,
    );
  }
  if (found.size > 0) {
    log.info(`已有邮箱示例: ${[...found].slice(0, 5).join(', ')}${found.size > 5 ? ' ...' : ''}`);
  }
  return found;
}

/**
 * 刷新列表数据后读取账号总数。
 * 标题里的「Test Accounts (N)」不会随创建/删除实时更新；点顶部 Sandbox 标签
 * 比重载整页更快，也能触发 ASC 重新拉数据。点不到 Tab 时才退回 page.reload。
 */
export async function refreshAndReadCount(page: Page, cfg: AppConfig): Promise<number | null> {
  const t = cfg.stepTimeoutMs;
  const before = await readAccountCount(page);

  log.step('点击 Sandbox 标签刷新列表数据 ...');
  const refreshed = await clickSandboxTab(page, cfg);
  if (!refreshed) {
    log.warn('未能点击 Sandbox 标签，退回整页刷新。');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: t }).catch(() => undefined);
  }

  await ensureOnSandboxPage(page, t).catch(() => undefined);

  // 标题数字可能稍晚才更新，等它相对刷新前发生变化（或超时后读当前值）。
  if (before !== null) {
    const deadline = Date.now() + Math.min(t, 8000);
    while (Date.now() < deadline) {
      const now = await readAccountCount(page);
      if (now !== null && now !== before) return now;
      await page.waitForTimeout(300);
    }
  }
  return readAccountCount(page);
}

/** 点击顶部 People / Sandbox / Xcode Cloud 里的 Sandbox 标签。返回是否点到了。 */
async function clickSandboxTab(page: Page, cfg: AppConfig): Promise<boolean> {
  const name = S.page.sandboxTabText;
  const candidates = [
    page.getByRole('tab', { name, exact: true }),
    page.getByRole('link', { name, exact: true }),
    page.getByRole('button', { name, exact: true }),
    page.getByText(name, { exact: true }),
  ];
  return clickFirstVisible(page, candidates, cfg.stepTimeoutMs, cfg.humanize);
}

/** 读取「Viewing X of Y items」的加载进度。读不到时返回 null。 */
async function readViewingProgress(page: Page): Promise<{ shown: number; total: number } | null> {
  const loc = page.getByText(S.page.viewingPattern).last();
  if (!(await isVisible(loc))) return null;
  const text = await loc.innerText().catch(() => '');
  const m = S.page.viewingPattern.exec(text);
  return m ? { shown: Number.parseInt(m[1], 10), total: Number.parseInt(m[2], 10) } : null;
}

/**
 * 把分页里未加载的行全部展开（点底部 Show More）。
 * 全部已加载（X >= Y）时直接返回，完全不碰滚动条——这是绝大多数情况。
 */
async function expandAllRows(page: Page, cfg: AppConfig): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const progress = await readViewingProgress(page);
    if (progress && progress.shown >= progress.total) {
      if (i === 0) log.info(`账号表已全部加载（${progress.shown}/${progress.total}），无需展开。`);
      return;
    }

    const showMore = page.getByRole('button', { name: S.page.showMoreText, exact: true }).first();
    const fallback = page.getByText(S.page.showMoreText, { exact: true }).first();
    const btn = (await isVisible(showMore)) ? showMore : fallback;
    if (!(await isVisible(btn))) return;
    if (!(await btn.isEnabled().catch(() => true))) return;

    log.info(
      `点击 Show More 展开更多账号（当前 ${progress?.shown ?? '?'}/${progress?.total ?? '?'}）...`,
    );
    await humanClick(page, btn, cfg.humanize, cfg.stepTimeoutMs);
    await page.waitForTimeout(800);
  }
}

/** 把滚动位置还原到指定纵坐标（已经在该位置时不做任何操作）。 */
async function restoreScroll(page: Page, y: number): Promise<void> {
  const current = await page.evaluate(() => window.scrollY).catch(() => y);
  if (Math.abs(current - y) < 4) return;
  await page.evaluate((top) => window.scrollTo(0, top), y).catch(() => undefined);
  await page.waitForTimeout(200);
}

/** 按邮箱定位账号表格行（精确匹配邮箱文本，避免前缀误伤）。 */
function findAccountRow(page: Page, email: string): Locator {
  return page.getByRole('row').filter({ has: page.getByText(email, { exact: true }) });
}

/**
 * 步骤：批量删除沙盒账号。
 * 展开列表 -> 按邮箱勾选复选框 -> 点右上角 Delete Accounts -> 确认弹窗。
 * dry-run 时勾选后点 Cancel 取消勾选，不真删。
 * 页面上找不到的邮箱记为 skipped，不阻断其余账号的删除。
 */
export async function deleteTesters(
  page: Page,
  accounts: SandboxAccount[],
  cfg: AppConfig,
): Promise<AccountResult[]> {
  const t = cfg.stepTimeoutMs;
  const hz = cfg.humanize;
  const results: AccountResult[] = [];

  await expandAllRows(page, cfg);

  const toDelete: SandboxAccount[] = [];
  for (const account of accounts) {
    const row = findAccountRow(page, account.email).first();
    if (!(await row.count())) {
      log.info(`↷ ${account.email} 页面上未找到，跳过删除。`);
      results.push({ account, status: 'skipped' });
      continue;
    }
    toDelete.push(account);
  }

  if (toDelete.length === 0) {
    log.warn('没有可删除的账号（页面上均未找到）。');
    return results;
  }

  log.step(`勾选 ${toDelete.length} 个待删除账号 ...`);
  for (const account of toDelete) {
    const row = findAccountRow(page, account.email).first();
    await row.scrollIntoViewIfNeeded({ timeout: t }).catch(() => undefined);
    const box = row.getByRole('checkbox').first();
    if (!(await box.count())) {
      throw new Error(
        `行「${account.email}」未找到复选框。请对照页面调整删除逻辑或 src/selectors.ts。`,
      );
    }
    const already = await box.isChecked().catch(() => false);
    if (!already) await humanClick(page, box, hz, t);
    await think(hz);
  }

  // 回读工具栏「Selected (N)」，确认勾选生效。
  const selected = page.getByText(S.batchDelete.selectedPattern).first();
  try {
    await selected.waitFor({ state: 'visible', timeout: t });
  } catch {
    throw new Error(
      `勾选后未出现「Selected (N)」工具栏。请对照页面调整 src/selectors.ts 的 batchDelete.selectedPattern。`,
    );
  }
  const selectedText = await selected.innerText().catch(() => '');
  const selectedMatch = S.batchDelete.selectedPattern.exec(selectedText);
  const selectedCount = selectedMatch ? Number.parseInt(selectedMatch[1], 10) : null;
  if (selectedCount !== null && selectedCount !== toDelete.length) {
    log.warn(
      `工具栏显示 Selected (${selectedCount})，与本次勾选 ${toDelete.length} 个不一致，仍继续。`,
    );
  } else {
    log.ok(`已勾选 ${toDelete.length} 个账号（${selectedText.trim()}）。`);
  }

  if (cfg.dryRun) {
    log.warn('dry-run：跳过 Delete Accounts，点 Cancel 取消勾选（不删除账号）');
    await clickByText(page, S.batchDelete.cancelSelectionText, t, hz);
    await selected.waitFor({ state: 'hidden', timeout: t }).catch(() => undefined);
    for (const account of toDelete) results.push({ account, status: 'dry-run' });
    return results;
  }

  log.step('点击右上角 Delete Accounts ...');
  const deleteBtn = await resolveDeleteButton(page);
  if (!(await deleteBtn.isEnabled().catch(() => true))) {
    throw new Error('Delete Accounts 按钮仍为禁用状态，勾选可能未生效。');
  }
  await humanClick(page, deleteBtn, hz, t);
  await think(hz);

  await confirmBatchDelete(page, cfg);

  // 等列表刷新后，核对目标邮箱是否消失。
  await page.waitForTimeout(Math.max(cfg.postCreateWaitMs, 1500));
  for (const account of toDelete) {
    const stillThere = (await findAccountRow(page, account.email).count()) > 0;
    if (stillThere) {
      log.error(`✖ ${account.email} 删除后仍在列表中。`);
      results.push({ account, status: 'failed', error: '点击删除后账号仍在列表中' });
    } else {
      log.ok(`✔ ${account.email} 已删除`);
      results.push({ account, status: 'deleted' });
    }
  }
  return results;
}

/** 定位右上角 Delete Accounts 按钮。 */
async function resolveDeleteButton(page: Page): Promise<Locator> {
  for (const name of S.batchDelete.deleteButtonTexts) {
    const btn = page.getByRole('button', { name, exact: true }).first();
    if (await isVisible(btn)) return btn;
  }
  throw new Error(
    `未找到「Delete Accounts」按钮。请对照页面调整 src/selectors.ts 的 batchDelete.deleteButtonTexts。`,
  );
}

/**
 * 处理删除二次确认弹窗（若有）。
 * 部分 ASC 版本点完工具栏 Delete Accounts 会再弹一次确认；没有弹窗则直接返回。
 */
async function confirmBatchDelete(page: Page, cfg: AppConfig): Promise<void> {
  const t = cfg.stepTimeoutMs;
  const hz = cfg.humanize;

  // 给弹窗一点出现时间；没有弹窗也不阻塞。
  await page.waitForTimeout(800);
  const dialog = page.getByRole('dialog');
  if (!(await isVisible(dialog))) {
    log.info('未出现二次确认弹窗，视为工具栏点击后已直接删除。');
    return;
  }

  const scope = dialog.first();
  for (const name of S.batchDelete.confirmButtonTexts) {
    const btn = scope.getByRole('button', { name, exact: true }).first();
    if (await isVisible(btn)) {
      log.step(`在确认弹窗中点击「${name}」`);
      await humanClick(page, btn, hz, t);
      await dialog
        .first()
        .waitFor({ state: 'hidden', timeout: t })
        .catch(() => undefined);
      return;
    }
  }

  throw new Error(
    '出现了确认弹窗，但未找到确认删除按钮。请对照页面调整 src/selectors.ts 的 batchDelete.confirmButtonTexts。',
  );
}

/**
 * 步骤 3：创建单个沙盒账号。
 * 点「+」-> 在 New Tester 弹窗填 First/Last Name、Email、Password、Confirm Password
 * -> 选 Country or Region -> 点 Create -> 校验弹窗关闭（未关闭则抓取报错文案抛出）。
 */
export async function createTester(
  page: Page,
  account: SandboxAccount,
  cfg: AppConfig,
): Promise<void> {
  const hz = cfg.humanize;

  await openNewTesterDialog(page, cfg);
  const dialog = await resolveDialog(page);

  try {
    log.step(`[${account.email}] 填写 New Tester 表单`);
    await fillField(page, dialog, S.dialog.labels.firstName, account.firstName, cfg);
    await fillField(page, dialog, S.dialog.labels.lastName, account.lastName, cfg);
    await fillField(page, dialog, S.dialog.labels.email, account.email, cfg, {
      placeholder: S.dialog.emailPlaceholder,
    });
    await fillField(page, dialog, S.dialog.labels.password, account.password, cfg, {
      passwordIndex: 0,
    });
    await fillField(page, dialog, S.dialog.labels.confirmPassword, account.password, cfg, {
      passwordIndex: 1,
    });

    log.step(`[${account.email}] 选择 Country or Region: ${account.country}`);
    await selectCountry(page, dialog, account.country, cfg);
    await think(hz);

    if (cfg.dryRun) {
      log.warn(`[${account.email}] dry-run：跳过 Create，点 Cancel 关闭弹窗（不创建账号）`);
      await closeDialog(page, dialog, cfg);
      return;
    }

    await submitAndVerify(page, dialog, account, cfg);
  } catch (e) {
    // 无论何种失败都把弹窗关掉，否则下一个账号连「+」都点不到。
    await closeDialog(page, dialog, cfg).catch(() => undefined);
    throw e;
  }
}

/** 点击标题右侧的「+」按钮，并等待 New Tester 弹窗出现。 */
async function openNewTesterDialog(page: Page, cfg: AppConfig): Promise<void> {
  const t = cfg.stepTimeoutMs;
  log.step('点击「+」打开 New Tester 弹窗');

  const candidates: Locator[] = [];

  // 策略 1：无障碍名称（最稳，ASC 一般给的是 Add）。
  for (const name of S.addButton.accessibleNames) {
    candidates.push(page.getByRole('button', { name, exact: true }));
  }
  // 策略 2：限定在标题所在容器内取按钮，避免误点页面其它加号。
  // 这里必须用带数量的「Test Accounts (23)」定位标题——左侧导航栏里也有一个纯
  // 「Test Accounts」条目，且在 DOM 里更靠前，用纯文本会取到导航栏那个容器。
  const heading = await resolveHeading(page);
  if (heading) {
    const box = heading.locator('xpath=ancestor::*[.//button or .//*[@role="button"]][1]');
    candidates.push(box.getByRole('button').first());
  }
  // 策略 3：CSS 兜底。
  for (const css of S.addButton.cssFallbacks) {
    candidates.push(page.locator(css));
  }

  if (!(await clickFirstVisible(page, candidates, t, cfg.humanize))) {
    throw new Error(
      '未能定位标题右侧的「+」按钮。请对照页面调整 src/selectors.ts 的 addButton.accessibleNames / cssFallbacks。',
    );
  }

  const title = page.getByText(S.dialog.titleText, { exact: true }).first();
  try {
    await title.waitFor({ state: 'visible', timeout: t });
  } catch {
    throw new Error(
      `点击「+」后未出现「${S.dialog.titleText}」弹窗。可能点到了别的按钮，请检查 src/selectors.ts 的 addButton。`,
    );
  }
  await think(cfg.humanize);
}

/**
 * 定位弹窗容器，后续所有查找都限定在它内部，避免命中列表页里的同名文本。
 * 优先 role=dialog；没有则从「New Tester」标题向上找最近的含 input 的祖先；再不行退回整页。
 */
async function resolveDialog(page: Page): Promise<Locator> {
  const byRole = page.getByRole('dialog');
  if (await isVisible(byRole)) return byRole.first();

  const title = page.getByText(S.dialog.titleText, { exact: true }).first();
  if (await isVisible(title)) {
    const container = title.locator('xpath=ancestor::*[.//input][1]');
    if (await isVisible(container)) return container.first();
  }

  log.warn('未识别到弹窗容器，退回整页查找（可能误命中列表页文本）。');
  return page.locator('body');
}

interface FillOptions {
  /** label 定位失败时用 placeholder 兜底。 */
  placeholder?: string;
  /** 密码类字段的兜底：弹窗内第 N 个 input[type=password]（0=Password，1=Confirm）。 */
  passwordIndex?: number;
}

/** 填写弹窗里某个带标签的输入框，并回读校验确实写进去了。 */
async function fillField(
  page: Page,
  dialog: Locator,
  label: string,
  value: string,
  cfg: AppConfig,
  opts: FillOptions = {},
): Promise<void> {
  const t = cfg.stepTimeoutMs;
  const input = await resolveInput(dialog, label, opts);
  await humanType(page, input, value, cfg.humanize, t);

  // React 受控组件偶发丢字符，回读一次并直填补救。
  let shown = (await input.inputValue().catch(() => '')).trim();
  if (shown !== value) {
    log.warn(`[${label}] 回显为 "${maskIfSecret(label, shown)}"，与目标不一致，直填重试一次。`);
    await input.fill(value).catch(() => undefined);
    shown = (await input.inputValue().catch(() => '')).trim();
    if (shown !== value) {
      throw new Error(
        `字段「${label}」未正确写入（回显 "${maskIfSecret(label, shown)}"）。` +
          `请对照页面调整 src/selectors.ts 的 dialog.labels。`,
      );
    }
  }
  await think(cfg.humanize);
}

/** 日志里不回显密码内容，只显示长度。 */
function maskIfSecret(label: string, value: string): string {
  return /password/i.test(label) ? `${value.length} 个字符` : value;
}

/** 多策略定位弹窗内某个标签对应的 input。 */
async function resolveInput(dialog: Locator, label: string, opts: FillOptions): Promise<Locator> {
  // 策略 1：label 与 input 有正确关联（for/aria-label）。
  const byLabel = dialog.getByLabel(label, { exact: true });
  if (await isVisible(byLabel)) return byLabel.first();

  // 策略 2：可见标签文本之后的第一个 input。exact 匹配可避免 Password 命中 Confirm Password。
  const byText = dialog
    .getByText(label, { exact: true })
    .first()
    .locator('xpath=following::input[1]');
  if (await isVisible(byText)) return byText.first();

  // 策略 3：placeholder（Email 用）。
  if (opts.placeholder) {
    const byPlaceholder = dialog.getByPlaceholder(opts.placeholder, { exact: false });
    if (await isVisible(byPlaceholder)) return byPlaceholder.first();
  }

  // 策略 4：密码字段按 input[type=password] 的出现顺序取。
  if (opts.passwordIndex !== undefined) {
    const pw = dialog.locator('input[type="password"]').nth(opts.passwordIndex);
    if (await isVisible(pw)) return pw;
  }

  throw new Error(
    `未能定位弹窗里「${label}」的输入框。请对照页面调整 src/selectors.ts 的 dialog.labels。`,
  );
}

/** 选择 Country or Region，兼容原生 select 与自定义下拉，并回读校验。 */
async function selectCountry(
  page: Page,
  dialog: Locator,
  country: string,
  cfg: AppConfig,
): Promise<void> {
  const t = cfg.stepTimeoutMs;
  const hz = cfg.humanize;
  const label = dialog.getByText(S.dialog.labels.country, { exact: true }).first();

  // 情况 A：原生 <select>（ASC 的国家选择目前是这种）。
  const nearLabel = label.locator('xpath=following::select[1]');
  const native = (await nearLabel.count()) ? nearLabel : dialog.locator('select');
  if (await native.count()) {
    const select = native.first();
    const ok = await select
      .selectOption({ label: country })
      .then(() => true)
      .catch(() => select.selectOption(country).then(() => true))
      .catch(() => false);
    if (ok) {
      await verifyCountry(select.locator('option:checked'), country);
      return;
    }
    log.warn(`原生 select 中未找到选项「${country}」，改用自定义下拉方式尝试。`);
  }

  // 情况 B：自定义下拉。先点开触发器（未选择时显示 Choose），再点选项。
  const triggers: Locator[] = [
    dialog.getByRole('combobox', { name: S.dialog.labels.country }),
    label.locator(`xpath=following::*[@role="combobox" or @role="button"][1]`),
    dialog.getByText(S.dialog.countryPlaceholderText, { exact: true }),
  ];
  if (!(await clickFirstVisible(page, triggers, t, hz))) {
    throw new Error(
      `未能定位 Country or Region 下拉框。请对照页面调整 src/selectors.ts 的 dialog.labels.country / countryPlaceholderText。`,
    );
  }
  await think(hz);

  const options: Locator[] = [
    page.getByRole('option', { name: country, exact: true }),
    page.getByText(country, { exact: true }),
  ];
  if (!(await clickFirstVisible(page, options, t, hz))) {
    throw new Error(`下拉里未找到国家/地区选项「${country}」，请确认拼写与页面完全一致。`);
  }
}

/** 回读已选国家，读到内容但不匹配时报错（避免静默创建到错误区域）。 */
async function verifyCountry(selected: Locator, country: string): Promise<void> {
  const shown = (await selected.innerText().catch(() => '')).trim();
  if (!shown) return; // 读不到就不阻塞，Create 时 Apple 侧仍会校验必填。
  if (shown.toLowerCase() !== country.toLowerCase()) {
    throw new Error(`Country or Region 实际为「${shown}」，与目标「${country}」不一致。`);
  }
  log.ok(`Country or Region 已确认: ${shown}`);
}

/** 点击 Create 并校验创建结果。 */
async function submitAndVerify(
  page: Page,
  dialog: Locator,
  account: SandboxAccount,
  cfg: AppConfig,
): Promise<void> {
  const t = cfg.stepTimeoutMs;

  const createBtn = dialog.getByRole('button', { name: S.dialog.createText, exact: true }).first();
  if ((await createBtn.count()) && !(await createBtn.isEnabled().catch(() => true))) {
    throw new Error(
      'Create 按钮仍为禁用状态，说明有必填项未被识别/未填成功。请检查各字段的填写与 src/selectors.ts。',
    );
  }

  log.step(`[${account.email}] 点击 Create`);
  await clickByText(page, S.dialog.createText, t, cfg.humanize, dialog);

  // 成功的标志是弹窗关闭；失败时弹窗保持打开并显示报错。
  const title = page.getByText(S.dialog.titleText, { exact: true }).first();
  try {
    await title.waitFor({ state: 'hidden', timeout: Math.max(cfg.postCreateWaitMs, 10000) });
  } catch {
    const detail = await readDialogError(dialog);
    const prefix = S.errors.duplicatePattern.test(detail) ? `${DUPLICATE_EMAIL}: ` : '';
    throw new Error(
      `${prefix}点击 Create 后弹窗未关闭，创建未成功。${detail ? `页面提示：${detail}` : '页面未给出明确提示。'}`,
    );
  }

  await page.waitForTimeout(cfg.postCreateWaitMs);
  log.ok(`[${account.email}] 已创建`);
}

/** 抓取弹窗内的报错文案（用于把 Apple 的原始提示带进日志/通知里）。 */
async function readDialogError(dialog: Locator): Promise<string> {
  for (const css of S.errors.messageSelectors) {
    const loc = dialog.locator(css);
    if (await isVisible(loc)) {
      const text = (
        await loc
          .first()
          .innerText()
          .catch(() => '')
      ).trim();
      if (text) return text.replace(/\s+/g, ' ').slice(0, 300);
    }
  }
  return '';
}

/** 关闭 New Tester 弹窗（优先点 Cancel，失败则按 Escape），并等它消失。 */
async function closeDialog(page: Page, dialog: Locator, cfg: AppConfig): Promise<void> {
  const t = cfg.stepTimeoutMs;
  await clickByText(page, S.dialog.cancelText, t, cfg.humanize, dialog).catch(async () => {
    await page.keyboard.press('Escape').catch(() => undefined);
  });
  await page
    .getByText(S.dialog.titleText, { exact: true })
    .first()
    .waitFor({ state: 'hidden', timeout: t })
    .catch(() => undefined);
}

/** 弹窗卡住无法关闭时的兜底：截图 + 强制刷新页面，让后续账号还能继续。 */
export async function recoverPage(page: Page, cfg: AppConfig, tag: string): Promise<void> {
  const title = page.getByText(S.dialog.titleText, { exact: true }).first();
  if (!(await isVisible(title))) return;

  log.warn('New Tester 弹窗未能关闭，刷新页面以恢复到干净状态 ...');
  await screenshotOnError(page, cfg.screenshotDir, `stuck_dialog_${tag}`);
  await page
    .reload({ waitUntil: 'domcontentloaded', timeout: cfg.stepTimeoutMs })
    .catch(() => undefined);
  await ensureOnSandboxPage(page, cfg.stepTimeoutMs);
}
