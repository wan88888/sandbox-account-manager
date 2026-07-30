import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  expandPattern,
  generateAccounts,
  loadAccountsCsv,
  validateAccounts,
  validatePassword,
} from '../src/accounts.js';
import type { AppConfig } from '../src/config.js';

/** 构造测试用的最小配置（只填 accounts.ts 会读到的字段）。 */
function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    password: 'Sandbox2026',
    country: 'United States',
    accountsCsvPath: './data/accounts.csv',
    generate: {
      count: 0,
      startIndex: 1,
      emailPattern: 'sandbox_us_{n}@example.com',
      firstNamePattern: 'Sandbox',
      lastNamePattern: '{n}',
    },
    ...overrides,
  } as AppConfig;
}

/** 把内容写进临时 CSV，返回其路径。 */
function writeTempCsv(content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'sandbox-test-')), 'accounts.csv');
  writeFileSync(path, content, 'utf-8');
  return path;
}

describe('expandPattern', () => {
  it('替换 {n} 为序号', () => {
    expect(expandPattern('sandbox_us_{n}@example.com', 7)).toBe('sandbox_us_7@example.com');
  });

  it('{n:3} 补零到指定宽度', () => {
    expect(expandPattern('us_{n:3}@example.com', 7)).toBe('us_007@example.com');
  });

  it('同一模板里的多个占位符都替换', () => {
    expect(expandPattern('{n} / {n:2}', 5)).toBe('5 / 05');
  });

  it('没有占位符时原样返回', () => {
    expect(expandPattern('Sandbox', 3)).toBe('Sandbox');
  });
});

describe('validatePassword', () => {
  it('满足 Apple 要求时返回空数组', () => {
    expect(validatePassword('Sandbox2026')).toEqual([]);
  });

  it('列出所有不满足的项', () => {
    expect(validatePassword('abc')).toEqual(['至少 8 位', '至少 1 个大写字母', '至少 1 个数字']);
  });
});

describe('generateAccounts', () => {
  it('按序号连续生成，并套用统一密码与国家', () => {
    const accounts = generateAccounts(
      makeConfig({
        generate: {
          count: 3,
          startIndex: 101,
          emailPattern: 'sandbox_us_{n}@example.com',
          firstNamePattern: 'US',
          lastNamePattern: 'SM {n}',
        },
      }),
    );

    expect(accounts.map((a) => a.email)).toEqual([
      'sandbox_us_101@example.com',
      'sandbox_us_102@example.com',
      'sandbox_us_103@example.com',
    ]);
    expect(accounts[0]).toMatchObject({
      firstName: 'US',
      lastName: 'SM 101',
      password: 'Sandbox2026',
      country: 'United States',
    });
  });

  it('邮箱模板缺少 {n} 时报错，避免生成一堆同名邮箱', () => {
    const cfg = makeConfig();
    cfg.generate.count = 2;
    cfg.generate.emailPattern = 'sandbox@example.com';
    expect(() => generateAccounts(cfg)).toThrow(/必须含 \{n\} 占位符/);
  });
});

describe('loadAccountsCsv', () => {
  it('解析明细表，缺列时用配置兜底', () => {
    const path = writeTempCsv('email,firstName,lastName\na@example.com,US,SM 1\nb@example.com,,\n');
    const accounts = loadAccountsCsv(path, makeConfig());

    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({
      email: 'a@example.com',
      firstName: 'US',
      lastName: 'SM 1',
      password: 'Sandbox2026',
      country: 'United States',
    });
    // 姓名列留空时退回生成模板（{n} 取行号）。
    expect(accounts[1]).toMatchObject({ firstName: 'Sandbox', lastName: '2' });
  });

  it('认中文表头', () => {
    const path = writeTempCsv('邮箱,密码,国家\na@example.com,Custom2026,Japan\n');
    const accounts = loadAccountsCsv(path, makeConfig());
    expect(accounts[0]).toMatchObject({ password: 'Custom2026', country: 'Japan' });
  });

  it('缺少 email 列时报错', () => {
    const path = writeTempCsv('firstName,lastName\nUS,SM 1\n');
    expect(() => loadAccountsCsv(path, makeConfig())).toThrow(/缺少 email 列/);
  });

  it('忽略末尾空行', () => {
    const path = writeTempCsv('email\na@example.com\n\n');
    expect(loadAccountsCsv(path, makeConfig())).toHaveLength(1);
  });
});

describe('validateAccounts', () => {
  const base = {
    firstName: 'US',
    lastName: 'SM',
    password: 'Sandbox2026',
    country: 'United States',
  };

  it('合法列表通过校验', () => {
    expect(() =>
      validateAccounts([
        { ...base, email: 'a@example.com' },
        { ...base, email: 'b@example.com' },
      ]),
    ).not.toThrow();
  });

  it('同批次内邮箱重复时报错（忽略大小写）', () => {
    expect(() =>
      validateAccounts([
        { ...base, email: 'a@example.com' },
        { ...base, email: 'A@example.com' },
      ]),
    ).toThrow(/邮箱在本批次内重复/);
  });

  it('密码不满足 Apple 规则时报错', () => {
    expect(() => validateAccounts([{ ...base, email: 'a@example.com', password: 'abc' }])).toThrow(
      /密码不满足 Apple 要求/,
    );
  });

  it('邮箱格式非法时报错', () => {
    expect(() => validateAccounts([{ ...base, email: 'not-an-email' }])).toThrow(/邮箱格式非法/);
  });

  it('删除模式只校验邮箱：缺密码和姓名也放行', () => {
    const account = {
      firstName: '',
      lastName: '',
      password: '',
      country: '',
      email: 'a@example.com',
    };
    expect(() => validateAccounts([account], 'delete')).not.toThrow();
    expect(() => validateAccounts([account], 'create')).toThrow(/缺少 First Name/);
  });

  it('删除模式仍拦下非法邮箱与批次内重复', () => {
    expect(() => validateAccounts([{ ...base, email: 'not-an-email' }], 'delete')).toThrow(
      /邮箱格式非法/,
    );
    expect(() =>
      validateAccounts(
        [
          { ...base, email: 'a@example.com' },
          { ...base, email: 'A@example.com' },
        ],
        'delete',
      ),
    ).toThrow(/邮箱在本批次内重复/);
  });
});
