/** 把创建成功的账号追加落盘成 CSV，方便直接交给测试同学。 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SandboxAccount } from './types.js';
import { csvRow } from './csv-utils.js';
import { log } from './logger.js';

const HEADER = ['email', 'password', 'firstName', 'lastName', 'country', 'createdAt'];

/**
 * 追加一条创建成功的账号记录。文件不存在时先写 BOM + 表头
 * （BOM 让 Excel / 飞书表格打开中文与邮箱都不乱码）。
 * 落盘失败只告警，不影响主流程——账号在 Apple 侧已经创建成功了。
 */
export function appendCreatedAccount(csvPath: string, account: SandboxAccount): void {
  if (!csvPath) return;

  try {
    const abs = resolve(process.cwd(), csvPath);
    mkdirSync(dirname(abs), { recursive: true });

    const isNew = !existsSync(abs);
    const line = csvRow([
      account.email,
      account.password,
      account.firstName,
      account.lastName,
      account.country,
      new Date().toISOString(),
    ]);
    appendFileSync(abs, `${isNew ? `\ufeff${csvRow(HEADER)}\n` : ''}${line}\n`, 'utf-8');
  } catch (e) {
    log.warn(`账号记录落盘失败（忽略）：${(e as Error).message}`);
  }
}
