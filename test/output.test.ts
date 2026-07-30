import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendCreatedAccount, outputCsvHeader } from '../src/output.js';
import type { SandboxAccount } from '../src/types.js';

const account: SandboxAccount = {
  email: 'a@example.com',
  password: 'SecretPass1',
  firstName: 'US',
  lastName: 'SM 1',
  country: 'United States',
};

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function tempCsv(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sam-output-'));
  dirs.push(dir);
  return join(dir, 'created.csv');
}

describe('outputCsvHeader', () => {
  it('默认不含 password', () => {
    expect(outputCsvHeader(false)).toEqual([
      'email',
      'firstName',
      'lastName',
      'country',
      'createdAt',
    ]);
  });

  it('开启时含 password', () => {
    expect(outputCsvHeader(true)).toContain('password');
  });
});

describe('appendCreatedAccount', () => {
  it('默认落盘不含明文密码', () => {
    const path = tempCsv();
    appendCreatedAccount(path, account);
    const text = readFileSync(path, 'utf-8');
    expect(text).toContain('email,firstName,lastName,country,createdAt');
    expect(text).toContain('a@example.com');
    expect(text).not.toContain('SecretPass1');
    expect(text).not.toMatch(/password/i);
  });

  it('includePassword 时写入明文密码', () => {
    const path = tempCsv();
    appendCreatedAccount(path, account, { includePassword: true });
    const text = readFileSync(path, 'utf-8');
    expect(text).toContain('email,password,firstName,lastName,country,createdAt');
    expect(text).toContain('SecretPass1');
  });

  it('已有 password 表头但未开启时，新行密码留空', () => {
    const path = tempCsv();
    writeFileSync(
      path,
      '\ufeffemail,password,firstName,lastName,country,createdAt\nold@example.com,OldPass1,A,B,United States,2020-01-01T00:00:00.000Z\n',
      'utf-8',
    );
    appendCreatedAccount(path, account);
    const lines = readFileSync(path, 'utf-8').trim().split(/\r?\n/);
    expect(lines[0]).toContain('password');
    expect(lines.at(-1)).toMatch(/^a@example.com,,US,SM 1,United States,/);
    expect(lines.at(-1)).not.toContain('SecretPass1');
  });
});
