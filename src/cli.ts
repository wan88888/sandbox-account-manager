/** 命令行参数解析。用法见 printHelp()。 */
export interface CliOptions {
  help: boolean;
  /** 演练：只填表、不点 Create（点 Cancel 关掉弹窗）。 */
  dryRun: boolean;
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
  /** 不主动导航，直接用当前标签页。 */
  useOpenPage: boolean;
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
    limit: 0,
    noSkipExisting: false,
    useOpenPage: false,
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
      case '--use-open-page':
        opts.useOpenPage = true;
        break;
      default:
        throw new Error(`未识别的命令行参数: ${arg}（用 --help 查看用法）`);
    }
  }

  return opts;
}

export function printHelp(): void {
  console.log(`
批量创建 App Store Connect 沙盒测试账号。

用法:
  npm start -- [选项]

选项:
  --dry-run              演练：打开 New Tester 并填好表，但点 Cancel 不真的创建
  --limit <N>            本次只处理前 N 个账号
  --count <N>            按规则生成 N 个账号（覆盖 .env 的 GEN_COUNT）
  --start <N>            生成序号从 N 开始（覆盖 .env 的 GEN_START_INDEX）
  --csv <path>           指定账号明细 CSV（覆盖 .env 的 ACCOUNTS_CSV）
  --no-skip-existing     跳过「读取页面已有账号并去重」的预扫描
  --use-open-page        不主动导航，直接使用当前已打开的标签页
  -h, --help             显示本帮助

示例:
  npm start -- --dry-run --limit 1          # 先拿 1 个账号演练，确认选择器没问题
  npm start -- --count 10 --start 101       # 生成 sandbox_us_101 ~ 110
  npm start -- --csv ./data/accounts.csv    # 用明细表创建
`);
}
