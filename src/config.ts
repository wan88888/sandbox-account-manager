import 'dotenv/config';
import type { FeishuConfig } from './notify.js';

function env(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

/** 拟人化行为配置（让操作节奏接近真人，降低自动化检测风险）。 */
export interface HumanizeConfig {
  /** 总开关。 */
  enabled: boolean;
  /** 步骤之间的随机「思考」停顿区间（毫秒）。 */
  thinkMinMs: number;
  thinkMaxMs: number;
  /** 逐字符键入时每个字符的随机间隔（毫秒）。 */
  typeMinMs: number;
  typeMaxMs: number;
  /** 每个账号创建之间的随机停顿区间（毫秒）。 */
  betweenAccountsMinMs: number;
  betweenAccountsMaxMs: number;
}

/** 无明细 CSV 时，按规则批量生成账号的参数。 */
export interface GenerateConfig {
  /** 生成多少个账号。0 表示不生成（此时必须提供明细 CSV）。 */
  count: number;
  /** 序号起始值，用于避开已创建过的编号。 */
  startIndex: number;
  /** 邮箱模板，含 {n} 占位符，如 sandbox_us_{n}@example.com；{n:3} 表示补零到 3 位。 */
  emailPattern: string;
  /** First Name 模板，可含 {n}。 */
  firstNamePattern: string;
  /** Last Name 模板，可含 {n}。 */
  lastNamePattern: string;
}

export interface AppConfig {
  adspower: {
    apiBase: string;
    apiKey: string;
    userId: string;
    /** AdsPower 本地 API 单次请求超时（毫秒）。 */
    timeoutMs: number;
  };
  /** App Store Connect 沙盒测试账号管理页地址。 */
  sandboxUrl: string;
  /** 账号明细 CSV 路径。文件存在时优先使用，否则退回按规则生成。 */
  accountsCsvPath: string;
  /** 按规则批量生成账号的参数（明细 CSV 不存在时生效）。 */
  generate: GenerateConfig;
  /** 统一密码（所有账号共用），CSV 里没填 password 的行也用它兜底。 */
  password: string;
  /** 默认 Country or Region，CSV 里没填 country 的行用它兜底。 */
  country: string;
  slowMoMs: number;
  stepTimeoutMs: number;
  /** 点击 Create 后等待服务端返回的时间（毫秒）。 */
  postCreateWaitMs: number;
  screenshotDir: string;
  /** 运行日志落盘目录。 */
  logDir: string;
  /** 创建成功的账号追加落盘的 CSV 路径，便于交付给测试同学。留空则不落盘。 */
  outputCsvPath: string;
  closeBrowserOnExit: boolean;
  /** 运行时开关（由命令行覆盖，见 cli.ts）。 */
  dryRun: boolean;
  /**
   * 开始前先读一遍页面上已有的账号邮箱，遇到重复直接跳过（幂等，可安全重跑）。
   * 关掉后重复邮箱会由 Apple 侧报错拦下，只是会多一次无效交互。
   */
  skipExisting: boolean;
  /** 即使当前标签页看起来不是沙盒页也不主动导航（你确定页面已就绪时用）。 */
  useOpenPage: boolean;
  /** 单次运行最多创建多少个账号。0 表示不限制。频率闸门。 */
  maxAccountsPerRun: number;
  /** 拟人化行为配置。 */
  humanize: HumanizeConfig;
  /** 飞书（Lark）运行结果通知配置。webhookUrl 留空则不通知。 */
  feishu: FeishuConfig;
}

/** 沙盒测试账号管理页的默认地址。 */
export const DEFAULT_SANDBOX_URL = 'https://appstoreconnect.apple.com/access/users/sandbox';

/** New Tester 弹窗里 Country or Region 的默认取值。 */
export const DEFAULT_COUNTRY = 'United States';

export function loadConfig(): AppConfig {
  const cfg: AppConfig = {
    adspower: {
      apiBase: env('ADSPOWER_API_BASE', 'http://local.adspower.net:50325').replace(/\/+$/, ''),
      apiKey: env('ADSPOWER_API_KEY'),
      userId: env('ADSPOWER_USER_ID'),
      timeoutMs: envInt('ADSPOWER_API_TIMEOUT_MS', 15000),
    },
    sandboxUrl: env('SANDBOX_URL', DEFAULT_SANDBOX_URL),
    accountsCsvPath: env('ACCOUNTS_CSV', './data/accounts.csv'),
    generate: {
      count: envInt('GEN_COUNT', 0),
      startIndex: envInt('GEN_START_INDEX', 1),
      emailPattern: env('GEN_EMAIL_PATTERN'),
      firstNamePattern: env('GEN_FIRST_NAME_PATTERN', 'Sandbox'),
      lastNamePattern: env('GEN_LAST_NAME_PATTERN', '{n}'),
    },
    password: env('SANDBOX_PASSWORD'),
    country: env('SANDBOX_COUNTRY', DEFAULT_COUNTRY),
    slowMoMs: envInt('SLOW_MO_MS', 50),
    stepTimeoutMs: envInt('STEP_TIMEOUT_MS', 30000),
    postCreateWaitMs: envInt('POST_CREATE_WAIT_MS', 2500),
    screenshotDir: env('SCREENSHOT_DIR', './screenshots'),
    logDir: env('LOG_DIR', './logs'),
    outputCsvPath: env('OUTPUT_CSV', './data/created-accounts.csv'),
    closeBrowserOnExit: envBool('CLOSE_BROWSER_ON_EXIT', false),
    dryRun: false,
    skipExisting: envBool('SKIP_EXISTING', true),
    useOpenPage: envBool('USE_OPEN_PAGE', false),
    maxAccountsPerRun: envInt('MAX_ACCOUNTS_PER_RUN', 0),
    humanize: {
      enabled: envBool('HUMANIZE', true),
      thinkMinMs: envInt('THINK_MIN_MS', 600),
      thinkMaxMs: envInt('THINK_MAX_MS', 2200),
      typeMinMs: envInt('TYPE_MIN_MS', 60),
      typeMaxMs: envInt('TYPE_MAX_MS', 180),
      betweenAccountsMinMs: envInt('BETWEEN_ACCOUNTS_MIN_MS', 4000),
      betweenAccountsMaxMs: envInt('BETWEEN_ACCOUNTS_MAX_MS', 12000),
    },
    feishu: {
      webhookUrl: env('FEISHU_WEBHOOK_URL'),
      signSecret: env('FEISHU_SIGN_SECRET'),
      timeoutMs: envInt('FEISHU_TIMEOUT_MS', 10000),
    },
  };

  if (!cfg.adspower.userId) {
    throw new Error('缺少 ADSPOWER_USER_ID，请在 .env 中填写要接管的 AdsPower profile 编号。');
  }
  return cfg;
}
