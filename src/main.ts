import { loadConfig } from './config.js';
import type { AppConfig } from './config.js';
import { parseCli, printHelp } from './cli.js';
import type { CliOptions } from './cli.js';
import { resolveAccounts } from './accounts.js';
import { startBrowser, stopBrowser, isActive } from './adspower.js';
import { connectBrowser, getPage, screenshotOnError } from './playwright-utils.js';
import {
  navigateToSandbox,
  readAccountCount,
  readExistingEmails,
  createTester,
  deleteTesters,
  recoverPage,
  refreshAndReadCount,
  isDuplicateEmail,
} from './steps.js';
import { appendCreatedAccount } from './output.js';
import type { AccountResult, SandboxAccount } from './types.js';
import { log, initFileLogging, getLogFile } from './logger.js';
import { pause } from './humanize.js';
import { notifyFeishu } from './notify.js';
import type { Page } from 'playwright';

/** 把命令行选项覆盖到配置上。 */
function applyCliOverrides(cfg: AppConfig, opts: CliOptions): void {
  cfg.dryRun = opts.dryRun;
  if (opts.noSkipExisting) cfg.skipExisting = false;
  if (opts.csv !== undefined) cfg.accountsCsvPath = opts.csv;
  if (opts.count !== undefined) cfg.generate.count = opts.count;
  if (opts.startIndex !== undefined) cfg.generate.startIndex = opts.startIndex;
}

/** 逐个创建账号，返回每个账号的处理结果。 */
async function createAccounts(
  page: Page,
  accounts: SandboxAccount[],
  cfg: AppConfig,
): Promise<AccountResult[]> {
  const results: AccountResult[] = [];

  await navigateToSandbox(page, cfg);

  const existing = cfg.skipExisting ? await readExistingEmails(page, cfg) : new Set<string>();
  const countBefore = await readAccountCount(page);
  if (countBefore !== null) log.info(`创建前页面显示账号总数：${countBefore}。`);

  for (const [i, account] of accounts.entries()) {
    const at = `[${i + 1}/${accounts.length}] ${account.email}`;

    if (existing.has(account.email.toLowerCase())) {
      log.info(`↷ ${at} 页面上已存在，跳过。`);
      results.push({ account, status: 'skipped' });
      continue;
    }

    log.info(`===== ${at} 开始创建 =====`);
    try {
      await createTester(page, account, cfg);
      if (cfg.dryRun) {
        results.push({ account, status: 'dry-run' });
      } else {
        results.push({ account, status: 'created' });
        // 已存在集合同步更新，避免同一批次里重复邮箱被创建两次。
        existing.add(account.email.toLowerCase());
        appendCreatedAccount(cfg.outputCsvPath, account);
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (isDuplicateEmail(msg)) {
        log.warn(`✖ ${at} 邮箱已被占用：${msg}`);
      } else {
        log.error(`✖ ${at} 创建失败：${msg}`);
        await screenshotOnError(page, cfg.screenshotDir, account.email);
      }
      results.push({ account, status: 'failed', error: msg });

      // 弹窗若卡住，刷新页面恢复，避免一个失败拖垮后面所有账号。
      await recoverPage(page, cfg, account.email).catch((err) => {
        log.warn(`页面恢复失败（继续尝试下一个账号）：${(err as Error).message}`);
      });
    }

    // 账号之间的随机停顿（拟人化 / 降频）。
    if (i < accounts.length - 1) {
      const ms = await pause(
        cfg.humanize,
        cfg.humanize.betweenAccountsMinMs,
        cfg.humanize.betweenAccountsMaxMs,
      );
      if (ms) log.info(`停顿 ${(ms / 1000).toFixed(1)}s 后继续 ...`);
    }
  }

  const createdCount = results.filter((r) => r.status === 'created').length;
  if (createdCount > 0 && countBefore !== null) {
    const countAfter = await refreshAndReadCount(page, cfg);
    if (countAfter !== null) {
      const delta = countAfter - countBefore;
      log.info(`刷新后页面显示账号总数：${countAfter}（净增 ${delta}）。`);
      if (delta !== createdCount) {
        log.warn(
          `页面净增 ${delta} 个，与本次判定成功的 ${createdCount} 个不一致，建议到页面上人工核对一遍。`,
        );
      }
    }
  }

  return results;
}

/** 批量删除账号：勾选 -> Delete Accounts -> 确认。 */
async function deleteAccounts(
  page: Page,
  accounts: SandboxAccount[],
  cfg: AppConfig,
): Promise<AccountResult[]> {
  await navigateToSandbox(page, cfg);

  const countBefore = await readAccountCount(page);
  if (countBefore !== null) log.info(`删除前页面显示账号总数：${countBefore}。`);

  log.info(`===== 开始批量删除 ${accounts.length} 个账号 =====`);
  let results: AccountResult[];
  try {
    results = await deleteTesters(page, accounts, cfg);
  } catch (e) {
    const msg = (e as Error).message;
    log.error(`批量删除失败：${msg}`);
    await screenshotOnError(page, cfg.screenshotDir, 'batch_delete');
    // 整批失败时，尚未产出结果的账号一律记为 failed。
    results = accounts.map((account) => ({ account, status: 'failed' as const, error: msg }));
  }

  const deletedCount = results.filter((r) => r.status === 'deleted').length;
  if (deletedCount > 0 && countBefore !== null) {
    const countAfter = await refreshAndReadCount(page, cfg);
    if (countAfter !== null) {
      const delta = countBefore - countAfter;
      log.info(`刷新后页面显示账号总数：${countAfter}（净减 ${delta}）。`);
      if (delta !== deletedCount) {
        log.warn(
          `页面净减 ${delta} 个，与本次判定成功的 ${deletedCount} 个不一致，建议到页面上人工核对一遍。`,
        );
      }
    }
  }

  return results;
}

function printSummary(results: AccountResult[], mode: 'create' | 'delete'): boolean {
  const created = results.filter((r) => r.status === 'created');
  const deleted = results.filter((r) => r.status === 'deleted');
  const skipped = results.filter((r) => r.status === 'skipped');
  const failed = results.filter((r) => r.status === 'failed');
  const dryRun = results.filter((r) => r.status === 'dry-run');

  const successLabel = mode === 'delete' ? '删除' : '新建';
  const success = mode === 'delete' ? deleted : created;

  log.info('================= 批处理汇总 =================');
  log.info(
    `共 ${results.length} 个：${successLabel} ${success.length}、跳过 ${skipped.length}、失败 ${failed.length}` +
      (dryRun.length ? `、演练 ${dryRun.length}` : ''),
  );
  for (const r of success) log.ok(`✔ ${r.account.email}`);
  for (const r of skipped) {
    log.info(
      mode === 'delete' ? `↷ ${r.account.email}（页面上未找到）` : `↷ ${r.account.email}（已存在）`,
    );
  }
  for (const r of failed) log.warn(`✖ ${r.account.email}: ${r.error}`);
  log.info('=============================================');

  return failed.length > 0;
}

/** 启动 AdsPower 浏览器并执行创建或删除。 */
async function runAutomation(
  cfg: AppConfig,
  accounts: SandboxAccount[],
  mode: 'create' | 'delete',
): Promise<AccountResult[]> {
  // 启动前探活：已在运行则提示直接接管；顺带尽早暴露「客户端未开启」类问题。
  if (await isActive(cfg.adspower)) {
    log.info('检测到该 AdsPower profile 浏览器已在运行，将直接接管。');
  }

  const wsEndpoint = await startBrowser(cfg.adspower);
  const browser = await connectBrowser(wsEndpoint, cfg.slowMoMs);
  const page = await getPage(browser, preferredHost(cfg));
  page.setDefaultTimeout(cfg.stepTimeoutMs);

  try {
    return mode === 'delete'
      ? await deleteAccounts(page, accounts, cfg)
      : await createAccounts(page, accounts, cfg);
  } finally {
    await browser.close().catch(() => undefined);
    if (cfg.closeBrowserOnExit) {
      await stopBrowser(cfg.adspower);
    } else {
      log.info('已断开 CDP 连接（AdsPower 浏览器保持开启）。');
    }
  }
}

/** 从沙盒页地址解析出主机名，用于优先接管命中该域名的标签页。 */
function preferredHost(cfg: AppConfig): string | undefined {
  try {
    return new URL(cfg.sandboxUrl).hostname || undefined;
  } catch {
    return undefined;
  }
}

/** 应用 --limit，得到本次真正要处理的账号列表。 */
function applyLimit(accounts: SandboxAccount[], limit: number): SandboxAccount[] {
  if (limit <= 0 || accounts.length <= limit) return accounts;
  log.warn(`--limit ${limit}：本次只处理前 ${limit} 个账号。`);
  return accounts.slice(0, limit);
}

async function run(): Promise<void> {
  const opts = parseCli();
  if (opts.help) {
    printHelp();
    return;
  }

  const cfg = loadConfig();
  applyCliOverrides(cfg, opts);
  const mode: 'create' | 'delete' = opts.delete ? 'delete' : 'create';

  initFileLogging(cfg.logDir);
  const logFile = getLogFile();
  if (logFile) log.info(`运行日志将写入: ${logFile}`);

  const accounts = applyLimit(resolveAccounts(cfg, mode), opts.limit);

  if (cfg.dryRun) {
    log.warn(
      mode === 'delete'
        ? '*** DRY-RUN 模式：只勾选账号，不会点 Delete Accounts ***'
        : '*** DRY-RUN 模式：只填表，不会点 Create ***',
    );
  }
  log.info(
    mode === 'delete'
      ? `本次待删除 ${accounts.length} 个沙盒账号。`
      : `本次待创建 ${accounts.length} 个沙盒账号，国家/地区默认 ${cfg.country}。`,
  );

  const startedAt = new Date();
  const results = await runAutomation(cfg, accounts, mode);

  const hasFailure = printSummary(results, mode);
  if (hasFailure) process.exitCode = 1;

  // 运行结果推送飞书（未配置 webhook 时内部静默跳过，失败也不影响退出码）。
  await notifyFeishu(cfg.feishu, {
    results,
    logFile,
    startedAt,
    finishedAt: new Date(),
    dryRun: cfg.dryRun,
    outputCsvPath: cfg.outputCsvPath,
    mode,
  });
}

run().catch((e) => {
  log.error((e as Error).stack ?? String(e));
  process.exitCode = 1;
});
