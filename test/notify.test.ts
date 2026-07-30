import { describe, expect, it } from 'vitest';
import { buildFeishuCard, type RunSummary } from '../src/notify.js';
import type { AccountResult, SandboxAccount } from '../src/types.js';

function account(email: string): SandboxAccount {
  return {
    firstName: 'US',
    lastName: 'SM',
    email,
    password: 'Sandbox2026',
    country: 'United States',
  };
}

function summary(
  results: AccountResult[],
  dryRun = false,
  mode: 'create' | 'delete' = 'create',
): RunSummary {
  return {
    results,
    logFile: '/tmp/run.log',
    startedAt: new Date('2026-07-30T02:00:00Z'),
    finishedAt: new Date('2026-07-30T02:01:30Z'),
    dryRun,
    outputCsvPath: './data/created-accounts.csv',
    mode,
  };
}

/** 把卡片扁平化成一段文本，便于断言内容是否出现。 */
function cardText(card: unknown): string {
  return JSON.stringify(card);
}

describe('buildFeishuCard', () => {
  it('全部成功时用绿色卡头', () => {
    const card = buildFeishuCard(
      summary([{ account: account('a@example.com'), status: 'created' }]),
    );
    expect(card.header.template).toBe('green');
    expect(card.header.title.content).toContain('全部完成');
    const text = cardText(card);
    expect(text).toContain('a@example.com');
    expect(text).toContain('Sandbox2026');
    expect(text).toContain('本次新建账号及密码');
  });

  it('有失败时用红色卡头，并按原因分组给出建议', () => {
    const card = buildFeishuCard(
      summary([
        { account: account('a@example.com'), status: 'created' },
        {
          account: account('b@example.com'),
          status: 'failed',
          error: 'DUPLICATE_EMAIL: already in use',
        },
        { account: account('c@example.com'), status: 'failed', error: '未能定位「+」按钮' },
      ]),
    );

    expect(card.header.template).toBe('red');
    const text = cardText(card);
    expect(text).toContain('邮箱已被占用');
    expect(text).toContain('页面元素定位失败');
  });

  it('dry-run 用灰色卡头并标注未创建', () => {
    const card = buildFeishuCard(
      summary([{ account: account('a@example.com'), status: 'dry-run' }], true),
    );
    expect(card.header.template).toBe('grey');
    expect(cardText(card)).toContain('未创建任何账号');
  });

  it('跳过的账号计入「已跳过」而非失败', () => {
    const card = buildFeishuCard(
      summary([{ account: account('a@example.com'), status: 'skipped' }]),
    );
    expect(card.header.template).toBe('green');
    expect(cardText(card)).toContain('已跳过');
  });

  it('删除模式用删除文案，并列出已删除邮箱', () => {
    const card = buildFeishuCard(
      summary([{ account: account('a@example.com'), status: 'deleted' }], false, 'delete'),
    );
    expect(card.header.title.content).toContain('批量删除');
    const text = cardText(card);
    expect(text).toContain('已删除');
    expect(text).toContain('a@example.com');
    expect(text).not.toContain('Sandbox2026');
  });

  it('删除 dry-run 标注未删除', () => {
    const card = buildFeishuCard(
      summary([{ account: account('a@example.com'), status: 'dry-run' }], true, 'delete'),
    );
    expect(card.header.template).toBe('grey');
    expect(cardText(card)).toContain('未删除任何账号');
  });
});
