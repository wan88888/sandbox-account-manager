import { describe, expect, it } from 'vitest';
import { parseCli } from '../src/cli.js';

describe('parseCli', () => {
  it('无参数时全部为默认值', () => {
    expect(parseCli([])).toEqual({
      help: false,
      dryRun: false,
      delete: false,
      limit: 0,
      noSkipExisting: false,
    });
  });

  it('解析带值的选项', () => {
    const opts = parseCli(['--count', '10', '--start', '101', '--csv', './x.csv', '--limit', '3']);
    expect(opts).toMatchObject({ count: 10, startIndex: 101, csv: './x.csv', limit: 3 });
  });

  it('解析开关型选项', () => {
    const opts = parseCli(['--dry-run', '--delete', '--no-skip-existing']);
    expect(opts).toMatchObject({ dryRun: true, delete: true, noSkipExisting: true });
  });

  it('带值选项缺参数时报错', () => {
    expect(() => parseCli(['--count'])).toThrow(/需要一个整数参数/);
    expect(() => parseCli(['--csv'])).toThrow(/需要一个参数值/);
  });

  it('未识别的参数直接报错，避免拼错时静默忽略', () => {
    expect(() => parseCli(['--dryrun'])).toThrow(/未识别的命令行参数/);
  });
});
