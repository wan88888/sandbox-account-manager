/**
 * 页面元素选择器集中配置（App Store Connect › Users and Access › Sandbox › Test Accounts）。
 *
 * ⚠️ App Store Connect 是 React 应用，class 名基本是混淆且不稳定的，所以这里尽量用
 * 「可见文本 / role / placeholder」定位，CSS 只作为最后兜底。页面改版时通常只需改本文件，
 * 业务逻辑代码无需改动。
 */
export const selectors = {
  /** 沙盒账号列表页本身。 */
  page: {
    /** 标题栏里的 Sandbox 标签（People / Sandbox / Xcode Cloud）。点它比重载整页更快地刷新列表数据。 */
    sandboxTabText: 'Sandbox',
    /** 列表标题（实际渲染为「Test Accounts (23)」）。 */
    headingText: 'Test Accounts',
    /** 用于确认已进入正确页面的候选文案（任一命中即认为已就绪）。 */
    readyTexts: ['Test Accounts', 'sandbox test accounts'],
    /** 从标题里抽出账号总数，用于创建前后对比校验。 */
    countPattern: /Test\s*Accounts\s*\((\d+)\)/i,
    /**
     * 表格右下角的加载进度「Viewing 23 of 23 items」。
     * 页面自己就写明了「已加载多少 / 共多少」，据此判断还要不要点 Show More，
     * 省掉「滚到底试探列表还有没有更多」这种会让页面来回跳动的做法。
     */
    viewingPattern: /Viewing\s+(\d+)\s+of\s+(\d+)\s+items/i,
    /** 表格底部的分页按钮（还有未加载的行时可点）。 */
    showMoreText: 'Show More',
  },

  /** 标题右侧那个蓝色圆形「+」按钮（打开 New Tester 弹窗）。 */
  addButton: {
    /** 无障碍名称候选（ASC 通常给的是 Add / ADD）。 */
    accessibleNames: ['Add', 'ADD', 'Add Tester', 'New Tester', 'Create', '添加', '新增'],
    /** 兜底 CSS：加号按钮的 class / data 属性里一般带 add。 */
    cssFallbacks: [
      'button[aria-label*="add" i]',
      'button[title*="add" i]',
      'button[class*="add" i]',
      '[data-test-id*="add" i]',
    ],
  },

  /** New Tester 弹窗。 */
  dialog: {
    /** 弹窗标题，用于确认弹窗已打开 / 已关闭。 */
    titleText: 'New Tester',
    /** 各输入框对应的可见标签文本。 */
    labels: {
      firstName: 'First Name',
      lastName: 'Last Name',
      email: 'Email',
      password: 'Password',
      confirmPassword: 'Confirm Password',
      country: 'Country or Region',
    },
    /** Email 输入框的 placeholder（label 定位失败时兜底）。 */
    emailPlaceholder: 'sandboxuser@tester.com',
    /** Country 下拉未选择时显示的占位文案（自定义下拉的触发器文本）。 */
    countryPlaceholderText: 'Choose',
    createText: 'Create',
    cancelText: 'Cancel',
  },

  /**
   * 批量删除：勾选行复选框 -> 点右上角「Delete Accounts」-> 确认弹窗。
   * 勾选后工具栏会出现「Selected (N)」与 Cancel / Clear Purchase History / Delete Accounts。
   */
  batchDelete: {
    /** 勾选后工具栏显示的选中数量，用于回读校验。 */
    selectedPattern: /Selected\s*\((\d+)\)/i,
    /** 右上角删除按钮文案候选。 */
    deleteButtonTexts: ['Delete Accounts', 'Delete Account'],
    /** 勾选后出现的「取消勾选」按钮，dry-run 时点它收尾。 */
    cancelSelectionText: 'Cancel',
    /** 二次确认弹窗里的确认按钮文案候选。 */
    confirmButtonTexts: ['Delete Accounts', 'Delete Account', 'Delete'],
    /** 确认弹窗取消按钮。 */
    confirmCancelText: 'Cancel',
  },

  /** 失败原因识别。 */
  errors: {
    /** 邮箱已被占用（含已存在的沙盒账号、已注册的 Apple Account）。 */
    duplicatePattern: /already (in use|been used|exists)|not available|已(被)?使用|已存在/i,
    /** 弹窗内错误提示的容器候选（用于抓取具体报错文案）。 */
    messageSelectors: ['[role="alert"]', '[class*="error" i]', '[class*="invalid" i]'],
  },

  /** 预扫描页面已有邮箱时要忽略的占位邮箱（不是真实账号）。 */
  ignoredEmails: ['sandboxuser@tester.com'],
};

export type Selectors = typeof selectors;
