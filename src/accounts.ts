import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { AppConfig } from './config.js';
import type { SandboxAccount } from './types.js';
import { log } from './logger.js';

/** 明细 CSV 各列的表头别名（小写、去空格后匹配），兼容中英文表头。 */
const COLUMN_ALIASES: Record<keyof SandboxAccount, string[]> = {
  firstName: ['firstname', 'first name', 'first_name', '名', '名字'],
  lastName: ['lastname', 'last name', 'last_name', '姓', '姓氏'],
  email: ['email', 'e-mail', '邮箱', 'appleaccount', 'apple account', 'sandbox apple account'],
  password: ['password', 'pwd', '密码'],
  country: ['country', 'region', 'country or region', '国家', '国家或地区'],
};

/**
 * 展开含序号占位符的模板：
 *  - `{n}`    -> 序号本身，如 7
 *  - `{n:3}`  -> 补零到 3 位，如 007
 */
export function expandPattern(pattern: string, n: number): string {
  return pattern.replace(/\{n(?::(\d+))?\}/g, (_, width: string | undefined) =>
    width ? String(n).padStart(Number.parseInt(width, 10), '0') : String(n),
  );
}

/**
 * 校验 Apple 沙盒账号密码是否满足要求（至少 8 位，且含大写、小写、数字）。
 * 返回不满足的项，全部满足时返回空数组。
 */
export function validatePassword(password: string): string[] {
  const issues: string[] = [];
  if (password.length < 8) issues.push('至少 8 位');
  if (!/[A-Z]/.test(password)) issues.push('至少 1 个大写字母');
  if (!/[a-z]/.test(password)) issues.push('至少 1 个小写字母');
  if (!/\d/.test(password)) issues.push('至少 1 个数字');
  return issues;
}

/** 把表头行解析成「字段 -> 列下标」的映射，找不到的字段下标为 -1。 */
function mapColumns(header: string[]): Record<keyof SandboxAccount, number> {
  const norm = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '));
  const find = (aliases: string[]): number => norm.findIndex((h) => aliases.includes(h));
  return {
    firstName: find(COLUMN_ALIASES.firstName),
    lastName: find(COLUMN_ALIASES.lastName),
    email: find(COLUMN_ALIASES.email),
    password: find(COLUMN_ALIASES.password),
    country: find(COLUMN_ALIASES.country),
  };
}

/** 读取账号明细 CSV。email 为必填列，其余列缺失时用配置里的默认值兜底。 */
export function loadAccountsCsv(csvPath: string, cfg: AppConfig): SandboxAccount[] {
  const abs = resolve(process.cwd(), csvPath);
  const records = parse(readFileSync(abs, 'utf-8'), {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as string[][];

  if (records.length < 2) {
    throw new Error(`账号明细 CSV 只有表头、没有数据行: ${abs}`);
  }

  const col = mapColumns(records[0]);
  if (col.email === -1) {
    throw new Error(
      `账号明细 CSV 缺少 email 列: ${abs}（表头可用 email / 邮箱，见 data/accounts.example.csv）。`,
    );
  }

  const cell = (row: string[], idx: number): string => (idx === -1 ? '' : (row[idx] ?? '').trim());

  const accounts: SandboxAccount[] = [];
  for (const [i, row] of records.slice(1).entries()) {
    const email = cell(row, col.email);
    if (!email) continue; // 容忍表格末尾的空行。

    const account: SandboxAccount = {
      firstName: cell(row, col.firstName) || expandPattern(cfg.generate.firstNamePattern, i + 1),
      lastName: cell(row, col.lastName) || expandPattern(cfg.generate.lastNamePattern, i + 1),
      email,
      password: cell(row, col.password) || cfg.password,
      country: cell(row, col.country) || cfg.country,
    };
    accounts.push(account);
  }

  if (accounts.length === 0) {
    throw new Error(`账号明细 CSV 里没有解析到任何有效邮箱: ${abs}`);
  }
  return accounts;
}

/** 按 .env 里的模板 + 数量批量生成账号。 */
export function generateAccounts(cfg: AppConfig): SandboxAccount[] {
  const { count, startIndex, emailPattern, firstNamePattern, lastNamePattern } = cfg.generate;

  if (!emailPattern) {
    throw new Error('按规则生成账号需要 GEN_EMAIL_PATTERN（如 sandbox_us_{n}@example.com）。');
  }
  if (!/\{n(?::\d+)?\}/.test(emailPattern)) {
    throw new Error(`GEN_EMAIL_PATTERN 必须含 {n} 占位符，否则每个账号邮箱相同: ${emailPattern}`);
  }

  const accounts: SandboxAccount[] = [];
  for (let i = 0; i < count; i++) {
    const n = startIndex + i;
    accounts.push({
      firstName: expandPattern(firstNamePattern, n),
      lastName: expandPattern(lastNamePattern, n),
      email: expandPattern(emailPattern, n),
      password: cfg.password,
      country: cfg.country,
    });
  }
  return accounts;
}

/**
 * 逐个账号做必填项校验，并排除同一批次内的重复邮箱。
 * 删除模式只认邮箱——姓名、国家、密码都不会填进页面，没必要拦下来。
 */
export function validateAccounts(
  accounts: SandboxAccount[],
  mode: 'create' | 'delete' = 'create',
): void {
  const seen = new Set<string>();
  for (const [i, a] of accounts.entries()) {
    const at = `第 ${i + 1} 个账号（${a.email || '邮箱为空'}）`;
    if (!a.email) throw new Error(`${at} 缺少邮箱。`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) throw new Error(`${at} 邮箱格式非法。`);

    if (mode === 'create') {
      if (!a.firstName || !a.lastName) throw new Error(`${at} 缺少 First Name 或 Last Name。`);
      if (!a.country) throw new Error(`${at} 缺少 Country or Region。`);

      if (!a.password) {
        throw new Error(
          `${at} 缺少密码。请在 .env 里设置 SANDBOX_PASSWORD，或在 CSV 的 password 列填写。`,
        );
      }
      const issues = validatePassword(a.password);
      if (issues.length > 0) {
        throw new Error(`${at} 密码不满足 Apple 要求（${issues.join('、')}）。`);
      }
    }

    const key = a.email.toLowerCase();
    if (seen.has(key)) throw new Error(`${at} 邮箱在本批次内重复。`);
    seen.add(key);
  }
}

/**
 * 解析本次要处理的账号列表，按优先级：
 *  1. 账号明细 CSV（ACCOUNTS_CSV，文件存在时优先，可精确控制每个账号的姓名/国家）；
 *  2. 按规则批量生成（GEN_EMAIL_PATTERN + GEN_COUNT，最省事）。
 */
export function resolveAccounts(
  cfg: AppConfig,
  mode: 'create' | 'delete' = 'create',
): SandboxAccount[] {
  const csvAbs = resolve(process.cwd(), cfg.accountsCsvPath);
  let accounts: SandboxAccount[];

  if (existsSync(csvAbs)) {
    accounts = loadAccountsCsv(cfg.accountsCsvPath, cfg);
    log.info(`账号来源：明细 CSV ${csvAbs}（${accounts.length} 个）。`);
  } else if (cfg.generate.count > 0) {
    accounts = generateAccounts(cfg);
    log.info(
      `账号来源：按规则生成（${cfg.generate.emailPattern}，序号 ${cfg.generate.startIndex} 起共 ${accounts.length} 个）。`,
    );
  } else {
    throw new Error(
      `没有可处理的账号：明细 CSV 不存在（${csvAbs}），GEN_COUNT 也未设置。` +
        `请二选一：复制 data/accounts.example.csv 为 data/accounts.csv 填好，或在 .env 里设置 GEN_EMAIL_PATTERN + GEN_COUNT。`,
    );
  }

  validateAccounts(accounts, mode);
  return accounts;
}
