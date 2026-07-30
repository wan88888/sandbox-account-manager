/** AdsPower 本地 API `/browser/start` 的响应结构（只声明用到的字段）。 */
export interface AdsPowerStartResponse {
  code: number;
  msg?: string;
  data?: {
    ws?: {
      puppeteer?: string;
      selenium?: string;
    };
  };
}

/** 一个待创建的沙盒测试账号。 */
export interface SandboxAccount {
  firstName: string;
  lastName: string;
  /** 沙盒 Apple Account（邮箱），全局唯一，作为幂等判重的依据。 */
  email: string;
  password: string;
  /** New Tester 弹窗里 Country or Region 的取值，如 United States。 */
  country: string;
}

/** 单个账号的处理结果。 */
export type AccountStatus =
  /** 已成功创建。 */
  | 'created'
  /** 已成功删除。 */
  | 'deleted'
  /** 页面上已存在同邮箱账号（创建时），或未找到目标账号（删除时），跳过。 */
  | 'skipped'
  /** dry-run 演练：创建时只填表不提交；删除时只勾选不点确认。 */
  | 'dry-run'
  /** 创建 / 删除失败。 */
  | 'failed';

export interface AccountResult {
  account: SandboxAccount;
  status: AccountStatus;
  /** status='failed' 时的失败原因。 */
  error?: string;
}
