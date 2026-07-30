/** 命令行参数解析。用法见 printHelp()。 */
export interface CliOptions {
  help: boolean;
  /** 演练：创建时只填表不点 Create；删除时只勾选不点 Delete Accounts。 */
  dryRun: boolean;
  /** 批量删除模式：按 accounts.csv 里的邮箱勾选后点 Delete Accounts。 */
  delete: boolean;
  /** 只处理前 N 个账号。0 表示不限制。 */
  limit: number;
  /** 覆盖 GEN_COUNT（按规则生成的数量）。undefined 表示不覆盖。 */
  count?: number;
  /** 覆盖 GEN_START_INDEX（序号起始值）。 */
  startIndex?: number;
  /** 覆盖 ACCOUNTS_CSV（账号明细表路径）。 */
  csv?: string;
  /** 不做「已存在则跳过」的预扫描。 */
  noSkipExisting: boolean;
}

function readInt(argv: string[], i: number, flag: string): number {
  const raw = argv[i + 1];
  const n = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`${flag} 需要一个整数参数，例如 ${flag} 10`);
  return n;
}

function readStr(argv: string[], i: number, flag: string): string {
  const raw = argv[i + 1];
  if (!raw || raw.startsWith('-')) throw new Error(`${flag} 需要一个参数值`);
  return raw;
}

export function parseCli(argv = process.argv.slice(2)): CliOptions {
  const opts: CliOptions = {
    help: false,
    dryRun: false,
    delete: false,
    limit: 0,
    noSkipExisting: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--delete':
        opts.delete = true;
        break;
      case '--limit':
        opts.limit = readInt(argv, i, '--limit');
        i++;
        break;
      case '--count':
        opts.count = readInt(argv, i, '--count');
        i++;
        break;
      case '--start':
        opts.startIndex = readInt(argv, i, '--start');
        i++;
        break;
      case '--csv':
        opts.csv = readStr(argv, i, '--csv');
        i++;
        break;
      case '--no-skip-existing':
        opts.noSkipExisting = true;
        break;
      default:
        throw new Error(`未识别的命令行参数: ${arg}（用 --help 查看用法）`);
    }
  }

  return opts;
}

export function printHelp(): void {
  console.log(`
批量创建 / 删除 App Store Connect 沙盒测试账号。

用法:
  npm start -- [选项]

选项:
  --delete               删除模式：勾选明细表里的邮箱，点右上角 Delete Accounts
  --dry-run              演练：创建时只填表不点 Create；删除时只勾选，点 Cancel 取消勾选
  --limit <N>            本次只处理前 N 个账号
  --count <N>            按规则生成 N 个账号（覆盖 .env 的 GEN_COUNT）
  --start <N>            生成序号从 N 开始（覆盖 .env 的 GEN_START_INDEX）
  --csv <path>           指定账号明细 CSV（覆盖 .env 的 ACCOUNTS_CSV）
  --no-skip-existing     跳过「读取页面已有账号并去重」的预扫描（仅创建模式）
  -h, --help             显示本帮助

示例:
  npm start -- --dry-run --limit 1          # 先拿 1 个账号演练创建
  npm start -- --csv ./data/accounts.csv    # 用明细表创建
  npm start -- --delete --dry-run           # 演练删除（只勾选，不真删）
  npm start -- --delete                     # 删除 accounts.csv 里列出的账号
`);
}
