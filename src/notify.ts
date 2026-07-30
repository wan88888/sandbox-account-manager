/** 运行结束后向飞书（Lark）自定义机器人推送本次批量创建结果。 */
import { createHmac } from 'node:crypto';
import type { AccountResult } from './types.js';
import { log } from './logger.js';

/** 飞书通知配置（对应 .env 里的 FEISHU_* 项）。 */
export interface FeishuConfig {
  /** 自定义机器人 Webhook 地址。留空则完全跳过通知。 */
  webhookUrl: string;
  /** 若机器人开启了「签名校验」，填写签名密钥；否则留空。 */
  signSecret: string;
  /** 发送请求的超时（毫秒）。 */
  timeoutMs: number;
}

/** 一次运行的结果摘要，用于拼装通知内容。 */
export interface RunSummary {
  results: AccountResult[];
  /** 本次运行日志文件路径（可能为 null）。 */
  logFile: string | null;
  /** 运行起止时间，用于展示耗时。 */
  startedAt: Date;
  finishedAt: Date;
  /** dry-run 模式标记（消息里注明，避免误读为真的建了账号）。 */
  dryRun: boolean;
  /** 创建成功的账号落盘 CSV 路径（未启用则为空串）。 */
  outputCsvPath: string;
}

/** 把毫秒时长格式化成 "Xm Ys" / "Ys"。 */
function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** 生成飞书签名：base64(HmacSHA256(key = `${timestamp}\n${secret}`, data = ""))。 */
function genSign(timestamp: number, secret: string): string {
  const stringToSign = `${timestamp}\n${secret}`;
  return createHmac('sha256', stringToSign).update('').digest('base64');
}

/** 转义 lark_md 里可能干扰渲染的字符（错误信息中常见）。 */
function escapeMd(s: string): string {
  return s.replace(/[*_~`]/g, (c) => `\\${c}`);
}

/** 全角空格（用转义，避免触发 no-irregular-whitespace；渲染出可见缩进）。 */
const FW = '\u3000';

/** 失败原因分类：用于把明细按原因归组，给出统一的处理建议。 */
type FailCategory = 'duplicate' | 'selector' | 'other';

interface CategoryMeta {
  icon: string;
  title: string;
  /** 给运营的一句话操作建议。 */
  advice: string;
}

const CATEGORY_ORDER: FailCategory[] = ['duplicate', 'selector', 'other'];

const CATEGORY_META: Record<FailCategory, CategoryMeta> = {
  duplicate: {
    icon: '🔁',
    title: '邮箱已被占用',
    advice: '该邮箱已是沙盒账号或已注册过 Apple Account，换个邮箱（或调大 GEN_START_INDEX）再跑。',
  },
  selector: {
    icon: '🧩',
    title: '页面元素定位失败（可能是 App Store Connect 改版）',
    advice: '对照 screenshots/ 里的截图调整 `src/selectors.ts`，再用 `--dry-run --limit 1` 验证。',
  },
  other: {
    icon: '❓',
    title: '其它错误',
    advice: '详见运行日志与 screenshots/ 截图。',
  },
};

function categorize(error: string): FailCategory {
  if (/DUPLICATE_EMAIL/.test(error)) return 'duplicate';
  if (/未能定位|未找到|未正确写入|未出现|无法确认/.test(error)) return 'selector';
  return 'other';
}

/** 把所有失败按原因归组。 */
function groupFailures(results: AccountResult[]): Map<FailCategory, AccountResult[]> {
  const groups = new Map<FailCategory, AccountResult[]>();
  for (const r of results) {
    if (r.status !== 'failed') continue;
    const cat = categorize(r.error ?? '');
    const arr = groups.get(cat) ?? [];
    arr.push(r);
    groups.set(cat, arr);
  }
  return groups;
}

const MAX_ITEMS_PER_GROUP = 20;

/** 一个失败分组渲染成一段 lark_md（标题 + 建议 + 受影响账号）。 */
function renderGroup(cat: FailCategory, items: AccountResult[]): string {
  const meta = CATEGORY_META[cat];
  const shown = items.slice(0, MAX_ITEMS_PER_GROUP);
  const more = items.length - shown.length;
  const list = shown.map((it) => `${FW}• ${escapeMd(it.account.email)}`).join('\n');
  const tail = more > 0 ? `\n${FW}… 等共 ${items.length} 个` : '';
  return (
    `**${meta.icon} ${meta.title}** · <font color='red'>${items.length}</font> 个\n` +
    `<font color='grey'>👉 ${meta.advice}</font>\n${list}${tail}`
  );
}

/** 四列统计（成功 / 跳过 / 失败 / 耗时），一眼看清整体。 */
function statColumns(
  created: number,
  total: number,
  skipped: number,
  failed: number,
  duration: string,
) {
  const col = (content: string): unknown => ({
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    elements: [{ tag: 'div', text: { tag: 'lark_md', content } }],
  });
  return {
    tag: 'column_set',
    flex_mode: 'stretch',
    background_style: 'default',
    columns: [
      col(`**✅ 已创建**\n<font color='green'>**${created}**</font> / ${total}`),
      col(`**↷ 已跳过**\n**${skipped}**`),
      col(
        failed > 0 ? `**❌ 失败**\n<font color='red'>**${failed}**</font>` : `**❌ 失败**\n**0**`,
      ),
      col(`**⏱ 耗时**\n${duration}`),
    ],
  };
}

/** 飞书交互卡片结构（仅覆盖用到的字段）。 */
export interface FeishuCard {
  config: { wide_screen_mode: boolean };
  header: { template: string; title: { tag: 'plain_text'; content: string } };
  elements: unknown[];
}

/** 把运行摘要拼成飞书交互卡片（大号统计 + 成功账号预览 + 失败按原因分组 + 操作建议）。 */
export function buildFeishuCard(summary: RunSummary): FeishuCard {
  const { results, logFile, startedAt, finishedAt, dryRun, outputCsvPath } = summary;

  const created = results.filter((r) => r.status === 'created');
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const duration = formatDuration(finishedAt.getTime() - startedAt.getTime());

  const elements: unknown[] = [];

  if (dryRun) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: "<font color='grey'>🧪 DRY-RUN 演练：只填表未点 Create，未创建任何账号。</font>",
      },
    });
  }

  elements.push(statColumns(created.length, results.length, skipped, failed, duration));

  // 成功账号预览（只列邮箱，密码统一在 .env / 落盘 CSV 里，不放到群里）。
  if (created.length > 0) {
    const shown = created.slice(0, MAX_ITEMS_PER_GROUP);
    const more = created.length - shown.length;
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content:
          `**🆕 本次新建账号**\n` +
          shown.map((r) => `${FW}• ${escapeMd(r.account.email)}`).join('\n') +
          (more > 0 ? `\n${FW}… 等共 ${created.length} 个` : ''),
      },
    });
  }

  // 失败按原因分组 + 操作建议。
  if (failed > 0) {
    const groups = groupFailures(results);
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: '**🔎 失败明细（按原因分组）**' },
    });
    for (const cat of CATEGORY_ORDER) {
      const items = groups.get(cat);
      if (items && items.length > 0) {
        elements.push({ tag: 'div', text: { tag: 'lark_md', content: renderGroup(cat, items) } });
      }
    }
  }

  const noteContents: unknown[] = [
    { tag: 'plain_text', content: `完成时间：${finishedAt.toLocaleString('zh-CN')}` },
  ];
  if (created.length > 0 && outputCsvPath) {
    noteContents.push({ tag: 'plain_text', content: `账号清单：${outputCsvPath}` });
  }
  if (logFile) noteContents.push({ tag: 'plain_text', content: `日志：${logFile}` });
  elements.push({ tag: 'note', elements: noteContents });

  const title = dryRun
    ? '🧪 沙盒账号批量创建 · 演练完成'
    : failed > 0
      ? '⚠️ 沙盒账号批量创建 · 部分失败'
      : '✅ 沙盒账号批量创建 · 全部完成';

  return {
    config: { wide_screen_mode: true },
    header: {
      template: dryRun ? 'grey' : failed > 0 ? 'red' : 'green',
      title: { tag: 'plain_text', content: title },
    },
    elements,
  };
}

/**
 * 向飞书自定义机器人推送本次运行结果（交互卡片）。
 * - 未配置 webhookUrl 时静默跳过（不影响主流程）。
 * - 任何网络/接口错误只记 warn，不抛出，避免影响退出码。
 */
export async function notifyFeishu(cfg: FeishuConfig, summary: RunSummary): Promise<void> {
  if (!cfg.webhookUrl) return;

  const body: Record<string, unknown> = {
    msg_type: 'interactive',
    card: buildFeishuCard(summary),
  };
  if (cfg.signSecret) {
    const timestamp = Math.floor(Date.now() / 1000);
    body.timestamp = String(timestamp);
    body.sign = genSign(timestamp, cfg.signSecret);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // 飞书即便参数有误也可能返回 HTTP 200，但 body.code !== 0，需一并检查。
    const data = (await res.json().catch(() => ({}))) as { code?: number; msg?: string };
    if (!res.ok || (data.code !== undefined && data.code !== 0)) {
      log.warn(`飞书通知发送失败：HTTP ${res.status}${data.msg ? ` - ${data.msg}` : ''}`);
    } else {
      log.info('已发送飞书通知。');
    }
  } catch (e) {
    const err = e as Error;
    const reason = err.name === 'AbortError' ? `请求超时（${cfg.timeoutMs}ms）` : err.message;
    log.warn(`飞书通知发送异常：${reason}`);
  } finally {
    clearTimeout(timer);
  }
}
