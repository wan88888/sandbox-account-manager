import type { Locator, Page } from 'playwright';
import type { HumanizeConfig } from './config.js';

/** [min, max] 闭区间随机整数。 */
function rand(min: number, max: number): number {
  if (max <= min) return Math.max(0, min);
  return Math.floor(min + Math.random() * (max - min + 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

/** 步骤之间的随机「思考」停顿。 */
export async function think(hz: HumanizeConfig): Promise<void> {
  if (!hz.enabled) return;
  await sleep(rand(hz.thinkMinMs, hz.thinkMaxMs));
}

/** 在给定区间内随机停顿（用于账号与账号之间）。 */
export async function pause(hz: HumanizeConfig, min: number, max: number): Promise<number> {
  if (!hz.enabled) return 0;
  const ms = rand(min, max);
  await sleep(ms);
  return ms;
}

/**
 * 拟人化点击：先滚动进视野，移动鼠标到元素中心（带轻微抖动）、短暂停顿，再点击。
 * hz 关闭时退化为普通 click。
 */
export async function humanClick(
  page: Page,
  locator: Locator,
  hz: HumanizeConfig,
  timeoutMs: number,
): Promise<void> {
  await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs }).catch(() => undefined);

  if (hz.enabled) {
    const box = await locator.boundingBox().catch(() => null);
    if (box) {
      const jitterX = rand(-Math.min(6, box.width / 4), Math.min(6, box.width / 4));
      const jitterY = rand(-Math.min(4, box.height / 4), Math.min(4, box.height / 4));
      const x = box.x + box.width / 2 + jitterX;
      const y = box.y + box.height / 2 + jitterY;
      await page.mouse.move(x, y, { steps: rand(4, 14) }).catch(() => undefined);
      await sleep(rand(80, 320));
    }
  }

  await locator.click({ timeout: timeoutMs });
}

/**
 * 拟人化输入：先点击聚焦并清空，再逐字符键入。
 * hz 关闭时退化为 fill。
 *
 * 用 pressSequentially 而不是自己按字符循环 keyboard.type：两者产生的按键事件序列
 * 完全一样，但前者是一次 Playwright 调用（逐字符在服务端完成），后者是 N 次。
 * 而 slowMo 按「每次调用」计费，自己循环会让 slowMo × 字符数，调试时填一个表能拖到几十秒。
 * 代价是字符间隔由「每字符随机」变成「每字段随机一次」，对防检测的影响可以忽略。
 */
export async function humanType(
  page: Page,
  locator: Locator,
  text: string,
  hz: HumanizeConfig,
  timeoutMs: number,
): Promise<void> {
  await humanClick(page, locator, hz, timeoutMs);

  // 清空现有内容。
  await locator.fill('').catch(async () => {
    await page.keyboard.press('Control+A').catch(() => undefined);
    await page.keyboard.press('Delete').catch(() => undefined);
  });

  if (!hz.enabled) {
    await locator.fill(text);
    return;
  }

  await locator.pressSequentially(text, {
    delay: rand(hz.typeMinMs, hz.typeMaxMs),
    timeout: timeoutMs,
  });
}
