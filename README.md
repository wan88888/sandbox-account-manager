# sandbox-account-manager

批量**创建**和**删除** App Store Connect 沙盒测试账号（Users and Access › Sandbox › Test Accounts）。
用 Playwright 通过 CDP 接管 AdsPower 浏览器，复用你已登录的会话。

## 它做什么

### 创建模式（默认）

对每个待创建账号重复以下动作：

1. 确认当前页面是沙盒测试账号列表页（已在该页则直接复用，不重复导航）；
2. 点击 **Test Accounts (N)** 标题右侧的蓝色 **+**，等 **New Tester** 弹窗出现；
3. 填 First Name、Last Name、Email、Password、Confirm Password，选 Country or Region（默认 United States）；
4. 点 **Create**，校验弹窗确实关闭；
5. 随机停顿几秒，继续下一个。

### 删除模式（`--delete`）

一次性批量删除，不是逐个删：

1. 展开列表全部行，按邮箱精确匹配勾选目标账号（页面上没有的记为「跳过」）；
2. 核对工具条上的 **Selected (N)** 与勾选数是否一致；
3. 点右上角 **Delete Accounts**，在二次确认弹窗里再点一次 **Delete Accounts**；
4. 回读列表确认这些邮箱确实消失了。

删除模式只用 CSV 里的 `email` 列，密码和姓名都不需要填。

### 两个模式共有

- **幂等**：创建前先读一遍页面已有邮箱，重复的跳过；删除时页面上找不到的也记跳过，中断后都可安全重跑；
- **回读校验**：创建时每个字段填完回读一次，React 丢字符时自动重填；删除后回读确认行已消失；
- **总数核对**：跑完点一次 **Sandbox** 标签刷新列表，比对账号总数的净增/净减是否与判定成功数一致，不一致会告警；
- **失败隔离**：创建时单个账号失败会截图、关弹窗（必要时刷新页面）再继续，不拖垮后面的账号；
- **结果落盘**：创建成功的账号追加写入 `data/created-accounts.csv`，可直接交给测试同学；
- **飞书通知**：跑完把「新建 / 删除 / 跳过 / 失败 + 失败原因分组 + 处理建议」推到群里。

## 快速开始

```bash
nvm use                      # Node >= 18
npm install
cp .env.example .env         # 至少填 ADSPOWER_USER_ID 和 SANDBOX_PASSWORD
```

在 AdsPower 里打开对应 profile，登录 App Store Connect。然后先演练一次确认选择器没问题：

```bash
npm start -- --dry-run --limit 1
```

演练会真的打开 New Tester 并填好表，但点的是 **Cancel**，不会创建账号。确认无误后正式跑：

```bash
npm start
```

## 批量删除

把要删的邮箱写进 `data/accounts.csv`（只需 `email` 列），先演练一次：

```bash
npm start -- --delete --dry-run    # 只勾选并核对 Selected (N)，然后点 Cancel 取消勾选
npm start -- --delete             # 确认无误后真删
```

删的账号和创建的账号无关，随便填哪些邮箱都行，页面上不存在的会记为「跳过」而不是失败：

```csv
email
old_us_1@example.com
old_us_2@example.com
```

创建完想立刻删掉这批，可以直接指向落盘清单：

```bash
npm start -- --delete --csv ./data/created-accounts.csv
```

## 账号从哪来

两种方式，**明细表优先**：

### 1. 明细表（精确控制每个账号）

```bash
cp data/accounts.example.csv data/accounts.csv
```

表头支持 `email` / `password` / `firstName` / `lastName` / `country`（也认 `邮箱`/`密码`/`姓`/`名`/`国家` 等中文表头），
只有 `email` 是必填列，其余留空时用 `.env` 里的默认值兜底：

```csv
email,password,firstName,lastName,country
sandbox_us_101@example.com,,US,SM 101,United States
sandbox_jp_001@example.com,,JP,SM 001,Japan
```

### 2. 按规则批量生成（最省事）

明细表不存在时生效。在 `.env` 里配好模板和数量：

```dotenv
GEN_EMAIL_PATTERN=sandbox_us_{n}@example.com
GEN_COUNT=10
GEN_START_INDEX=101
GEN_FIRST_NAME_PATTERN=US
GEN_LAST_NAME_PATTERN=SM {n}
```

`{n}` 是序号，`{n:3}` 表示补零到 3 位（`001`）。也可用命令行临时覆盖：

```bash
npm start -- --count 10 --start 101
```

## 命令行选项

| 选项                 | 作用                                                 |
| -------------------- | ---------------------------------------------------- |
| `--delete`           | 删除模式：勾选明细表里的邮箱后点 Delete Accounts     |
| `--dry-run`          | 演练：创建时填好表点 Cancel；删除时只勾选，不点删除  |
| `--limit <N>`        | 本次只处理前 N 个账号                                |
| `--count <N>`        | 按规则生成 N 个账号（覆盖 `GEN_COUNT`）              |
| `--start <N>`        | 生成序号从 N 开始（覆盖 `GEN_START_INDEX`）          |
| `--csv <path>`       | 指定账号明细表（覆盖 `ACCOUNTS_CSV`）                |
| `--no-skip-existing` | 跳过「读取页面已有账号并去重」的预扫描（仅创建模式） |
| `-h`, `--help`       | 查看用法                                             |

## 配置

全部配置项都在 `.env.example` 里带注释说明，常用的几个：

| 变量                                                  | 说明                                                  |
| ----------------------------------------------------- | ----------------------------------------------------- |
| `ADSPOWER_USER_ID`                                    | 要接管的 AdsPower profile 编号，**必填**              |
| `SANDBOX_PASSWORD`                                    | 所有账号共用的密码，**必填**（≥8 位且含大小写与数字） |
| `SANDBOX_COUNTRY`                                     | 默认 Country or Region，需与页面选项文字完全一致      |
| `SKIP_EXISTING`                                       | 是否预扫描已有邮箱去重，默认 `true`                   |
| `BETWEEN_ACCOUNTS_MIN_MS` / `BETWEEN_ACCOUNTS_MAX_MS` | 账号之间的随机停顿区间                                |
| `OUTPUT_CSV`                                          | 创建成功的账号追加落盘路径，留空则不落盘              |
| `FEISHU_WEBHOOK_URL`                                  | 飞书群自定义机器人 Webhook，留空则不通知              |

> `data/*.csv`（含密码）和 `logs/`、`screenshots/` 都已在 `.gitignore` 里，不会入库。

## 页面改版了怎么办

所有页面元素定位都集中在 `src/selectors.ts`，业务逻辑不需要改。
失败时 `screenshots/` 下会有整页截图，文件名前缀与 `logs/run-<时间戳>.log` 一致，对照着改选择器即可，
改完用 `npm start -- --dry-run --limit 1` 验证。

常见报错与处理：

| 报错                          | 原因与处理                                                                 |
| ----------------------------- | -------------------------------------------------------------------------- |
| 无法确认已在沙盒测试账号页    | App Store Connect 未登录或会话过期，在浏览器里登录后重跑                   |
| 未能定位标题右侧的「+」按钮   | 加号按钮改版，调 `selectors.addButton`                                     |
| Create 按钮仍为禁用状态       | 有必填项没填进去，看日志里哪个字段回读失败，调 `selectors.dialog.labels`   |
| `DUPLICATE_EMAIL`             | 邮箱已被占用，换邮箱或调大 `GEN_START_INDEX`                               |
| 未能定位 Delete Accounts 按钮 | 删除工具条改版，调 `selectors.batchDelete`                                 |
| 勾选数与 Selected (N) 不一致  | 有行没勾上或勾错了，看截图核对，调 `selectors.batchDelete.selectedPattern` |

## 代码结构

| 文件                      | 职责                                                        |
| ------------------------- | ----------------------------------------------------------- |
| `src/main.ts`             | 编排：解析参数 → 接管浏览器 → 创建/删除 → 汇总 + 通知       |
| `src/accounts.ts`         | 账号来源解析（明细表 / 规则生成）与校验                     |
| `src/steps.ts`            | 页面操作步骤：进页面、读已有账号、填表 Create、批量勾选删除 |
| `src/selectors.ts`        | 页面元素定位，**改版时只改这里**                            |
| `src/config.ts`           | `.env` 配置读取                                             |
| `src/cli.ts`              | 命令行参数                                                  |
| `src/adspower.ts`         | AdsPower 本地 API（启动 / 关闭 / 探活）                     |
| `src/playwright-utils.ts` | CDP 接管、窗口最大化、出错截图、多策略点击                  |
| `src/humanize.ts`         | 拟人化停顿、鼠标移动、逐字符输入                            |
| `src/output.ts`           | 创建成功的账号落盘 CSV                                      |
| `src/notify.ts`           | 飞书结果卡片                                                |
| `src/logger.ts`           | 控制台 + 文件日志                                           |

## 开发

```bash
npm run check        # typecheck + lint + format:check + test
npm test             # 仅单测
npm run lint:fix     # 自动修 lint
npm run format       # 自动格式化
```
