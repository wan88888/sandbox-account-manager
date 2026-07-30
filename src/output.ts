/** 把创建成功的账号追加落盘成 CSV，方便直接交给测试同学。 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SandboxAccount } from './types.js';
import { csvRow } from './csv-utils.js';
import { log } from './logger.js';

const HEADER_WITHOUT_PASSWORD = ['email', 'firstName', 'lastName', 'country', 'createdAt'];
const HEADER_WITH_PASSWORD = ['email', 'password', 'firstName', 'lastName', 'country', 'createdAt'];

export interface AppendCreatedAccountOptions {
  /** 是否在落盘 CSV 中写入明文密码。默认 false。 */
  includePassword?: boolean;
}

/**
 * 追加一条创建成功的账号记录。文件不存在时先写 BOM + 表头
 * （BOM 让 Excel / 飞书表格打开中文与邮箱都不乱码）。
 * 默认不含 password 列；需要明文密码时传 includePassword: true。
 * 落盘失败只告警，不影响主流程——账号在 Apple 侧已经创建成功了。
 */
export function appendCreatedAccount(
  csvPath: string,
  account: SandboxAccount,
  opts: AppendCreatedAccountOptions = {},
): void {
  if (!csvPath) return;

  const includePassword = opts.includePassword === true;

  try {
    const abs = resolve(process.cwd(), csvPath);
    mkdirSync(dirname(abs), { recursive: true });

    const isNew = !existsSync(abs);
    const header = resolveHeader(abs, isNew, includePassword);
    const fields = fieldsForHeader(header, account, includePassword);

    appendFileSync(abs, `${isNew ? `\ufeff${csvRow(header)}\n` : ''}${csvRow(fields)}\n`, 'utf-8');
  } catch (e) {
    log.warn(`账号记录落盘失败（忽略）：${(e as Error).message}`);
  }
}

/** 新文件按开关选表头；已有文件沿用其表头，避免列错位。 */
function resolveHeader(abs: string, isNew: boolean, includePassword: boolean): string[] {
  const preferred = includePassword ? HEADER_WITH_PASSWORD : HEADER_WITHOUT_PASSWORD;
  if (isNew) return preferred;

  const existing = readExistingHeader(abs);
  if (!existing) return preferred;

  const existingHasPassword = existing.some((h) => /^password$/i.test(h));
  if (existingHasPassword && !includePassword) {
    log.warn(
      `落盘文件已有 password 列，但本次未开启「输出密码」：新行 password 将留空。` +
        `如需写入密码请加 --output-with-passwords 或设 OUTPUT_CSV_WITH_PASSWORDS=true；` +
        `若要去掉该列请删除或换名后重跑。`,
    );
  }
  return existing;
}

function readExistingHeader(abs: string): string[] | null {
  try {
    const raw = readFileSync(abs, 'utf-8').replace(/^\ufeff/, '');
    const firstLine = raw.split(/\r?\n/).find((line) => line.trim());
    if (!firstLine) return null;
    return firstLine.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  } catch {
    return null;
  }
}

function fieldsForHeader(
  header: string[],
  account: SandboxAccount,
  includePassword: boolean,
): string[] {
  const createdAt = new Date().toISOString();
  const values: Record<string, string> = {
    email: account.email,
    firstname: account.firstName,
    lastname: account.lastName,
    country: account.country,
    createdat: createdAt,
    // 仅显式开启时写明文密码；沿用旧表头但未开启时该列留空，避免继续泄露。
    password: includePassword ? account.password : '',
  };

  return header.map((col) => values[col.toLowerCase()] ?? '');
}

/** 供单测断言默认 / 带密码表头。 */
export function outputCsvHeader(includePassword: boolean): string[] {
  return includePassword ? [...HEADER_WITH_PASSWORD] : [...HEADER_WITHOUT_PASSWORD];
}
