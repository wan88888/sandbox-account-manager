import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
} from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { log, getRunId } from './logger.js';
import type { HumanizeConfig } from './config.js';
import { humanClick } from './humanize.js';

/** 未启用拟人化时的兜底配置。 */
const NO_HUMANIZE: HumanizeConfig = {
  enabled: false,
  thinkMinMs: 0,
  thinkMaxMs: 0,
  typeMinMs: 0,
  typeMaxMs: 0,
  betweenAccountsMinMs: 0,
  betweenAccountsMaxMs: 0,
};

/** 接管 AdsPower 已启动的浏览器（CDP）。 */
export async function connectBrowser(wsEndpoint: string, slowMoMs: number): Promise<Browser> {
  const browser = await chromium.connectOverCDP(wsEndpoint, { slowMo: slowMoMs });
  log.ok('已通过 CDP 接管 AdsPower 浏览器');
  return browser;
}

/**
 * 取得（或新建）一个可用的 page。
 * 若传入 preferHost（如 appstoreconnect.apple.com），优先复用 URL 命中该域名的标签页，
 * 避免 AdsPower 里存在欢迎页/多标签时误接管到错误的 tab；否则退回第一个标签页。
 */
export async function getPage(browser: Browser, preferHost?: string): Promise<Page> {
  const context = browser.contexts()[0];
  if (!context) throw new Error('浏览器没有可用的 context');
  const existing = context.pages();

  let page: Page | undefined;
  if (preferHost && existing.length > 0) {
    page = existing.find((p) => {
      try {
        return new URL(p.url()).hostname.includes(preferHost);
      } catch {
        return false;
      }
    });
    if (page) log.info(`复用匹配「${preferHost}」的已打开标签页`);
  }
  if (!page) page = existing.length > 0 ? existing[0] : await context.newPage();

  await page.bringToFront();
  await maximizeWindow(context, page);
  return page;
}

/** CDP 里的窗口状态。macOS 点绿色按钮进的是 fullscreen，与 maximized 是两种不同状态。 */
type WindowState = 'normal' | 'minimized' | 'maximized' | 'fullscreen';

/**
 * 通过 CDP 把 AdsPower 浏览器窗口最大化。
 * connectOverCDP 接管的是真实浏览器窗口，setViewportSize 无效，
 * 需用 Browser.setWindowBounds({ windowState: 'maximized' })。
 *
 * CDP 不允许从 fullscreen / minimized 直接切到 maximized，会报
 * 「To maximize a minimized or fullscreen window, restore it to normal state first」，
 * 所以先读当前状态：本来就够大的直接不动，最小化的先恢复成 normal 再最大化。
 */
async function maximizeWindow(context: BrowserContext, page: Page): Promise<void> {
  let session: CDPSession | undefined;
  try {
    session = await context.newCDPSession(page);
    const { windowId } = (await session.send('Browser.getWindowForTarget')) as {
      windowId: number;
    };
    const { bounds } = (await session.send('Browser.getWindowBounds', { windowId })) as {
      bounds: { windowState?: WindowState };
    };
    const state = bounds.windowState ?? 'normal';

    // 用户已手动最大化 / 全屏：视野本来就够，不去打扰它。
    if (state === 'maximized' || state === 'fullscreen') {
      log.info(`浏览器窗口已是 ${state} 状态，跳过最大化。`);
      return;
    }

    if (state === 'minimized') {
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: 'normal' },
      });
    }
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'maximized' },
    });
    log.ok('已最大化浏览器窗口');
  } catch (e) {
    log.warn(`最大化窗口失败（忽略）：${(e as Error).message}`);
  } finally {
    await session?.detach().catch(() => undefined);
  }
}

/**
 * 出错时保存整页截图，便于排查选择器问题。
 * 文件名以本次运行的 runId 打头（与 logs/run-<runId>.log 同前缀），
 * 方便把「某次运行日志」和「该次出错截图」对应起来。
 */
export async function screenshotOnError(page: Page, dir: string, name: string): Promise<void> {
  try {
    mkdirSync(resolve(process.cwd(), dir), { recursive: true });
    const safe = name.replace(/[^\w.-]+/g, '_');
    const runId = getRunId();
    const prefix = runId ? `run-${runId}_` : '';
    const path = resolve(process.cwd(), dir, `${prefix}${Date.now()}_${safe}.png`);
    await page.screenshot({ path, fullPage: true });
    log.warn(`已保存出错截图: ${path}`);
  } catch (e) {
    log.warn(`保存截图失败: ${(e as Error).message}`);
  }
}

/** 判断一个 locator 是否有可见元素（不抛错）。 */
export async function isVisible(locator: Locator): Promise<boolean> {
  try {
    return (await locator.count()) > 0 && (await locator.first().isVisible());
  } catch {
    return false;
  }
}

/**
 * 依次尝试一组候选 locator，点击第一个可见的。
 * 用于「同一个按钮在不同版本 UI 里定位方式不同」的场景。返回是否点到了。
 */
export async function clickFirstVisible(
  page: Page,
  candidates: Locator[],
  timeoutMs: number,
  hz: HumanizeConfig = NO_HUMANIZE,
): Promise<boolean> {
  for (const loc of candidates) {
    if (await isVisible(loc)) {
      await humanClick(page, loc.first(), hz, timeoutMs);
      return true;
    }
  }
  return false;
}

/** 点击一个可见文本（按钮 / 菜单项 / 链接），带兜底。 */
export async function clickByText(
  page: Page,
  text: string,
  timeoutMs: number,
  hz: HumanizeConfig = NO_HUMANIZE,
  scope?: Locator,
): Promise<void> {
  const root = scope ?? page;
  const clicked = await clickFirstVisible(
    page,
    [
      root.getByRole('button', { name: text, exact: true }),
      root.getByRole('menuitem', { name: text, exact: true }),
      root.getByRole('link', { name: text, exact: true }),
      root.getByText(text, { exact: true }),
    ],
    timeoutMs,
    hz,
  );
  if (!clicked) throw new Error(`未找到可点击的元素文本: "${text}"`);
}
