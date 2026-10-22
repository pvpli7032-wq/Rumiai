# 启动与部署

> 权威依据：`docs/planning/commercial-implementation-plan.md`（工程契约）与 V3 终稿第 27 章（迁移部署与资料整理）。
> 本文件只写**本仓库当前真实存在的命令、路径与流程**；服务器地址、账号与密钥一律不写入仓库，凭据只留在本机受保护位置。

## 1. 环境与依赖

- Node.js：生产按 `deploy/baota/README.md` 使用服务器已安装的 Node 24；本地用仓库 `node_modules` 同一锁文件。
- 数据库：SQLite（单文件），Prisma 管理结构与迁移。
- 依赖安装：`npm ci`（发布包必须带 `package-lock.json`，不新增依赖）。

## 2. 本地启动

```bash
npm ci
npx prisma generate
npm run db:local        # 用 node:sqlite 顺序执行 prisma/migrations，适合本机
npm run dev             # 开发服务器
```

`db:local` 是在本机 Prisma schema engine 不可用时的替代入口：它按顺序执行 `prisma/migrations/**/migration.sql` 并写入 `_prisma_migrations`。正式库升级仍以 `npx prisma migrate deploy` 为准。

## 3. 环境变量

模板见 `.env.example`，生产配置放在服务器 `/www/wwwroot/khui-ai/shared/app.env`（权限 600，发布目录软链读取，禁止打进源码包）。

只列**必须在环境里给**的：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | 必须是数据库文件绝对路径；本地用 `file:./dev.db`。 |
| `UPLOADS_DIRECTORY` | 上传目录，与数据库同实例、同备份、同恢复。 |
| `JWT_SECRET` | 至少 32 位随机会话密钥；恢复数据库后轮换。 |
| `AI_PROVIDER_ENCRYPTION_KEY` / `PAYMENT_MERCHANT_ENCRYPTION_KEY` | 64 位十六进制主密钥，加密保存在库里的供应商/商户凭据；**保持稳定并单独备份**，更换会导致历史凭据不可读。 |
| `DISABLE_MOCK_AI` / `ALLOW_SIMULATED_PURCHASES` | 生产必须 `true` / `false`：不模拟 AI、不模拟充值。 |
| `EZFP_ENABLED` / `EZFP_REFUNDS_ENABLED` | 真实支付总开关，默认关闭；开启前先在后台配好套餐人民币价与正式商户。 |

运营参数（字数、频率、额度、币价、玩法开关、提示词）已迁到设置中心，见 `docs/modules-and-apis.md` 第 6 节，**不再新增环境变量**；旧的兜底环境变量随该组迁移完成即删除。

## 4. 构建与验证

```bash
npm run typecheck                          # tsc --noEmit
npm run verify:build                       # 独立空库跑迁移 + 生产构建（ISOLATED_BUILD_DIR）
npm run build                              # 生产构建，产物在 .next-build
npm run release:check -- <数据库绝对路径>   # 只读核对迁移历史是否兼容本发布
```

- 生产构建产物固定写 `.next-build`，避免覆盖开发服务器的 `.next` 缓存。
- `verify:build` 的隔离库每次随机命名，构建结束即删除；不得把生产库当构建库。
- `release:check` 拒绝待应用、未完成与数据库独有的迁移；`npm start` 启动前会自动执行同一检查，退出码非 0 不放行。

## 5. 迁移与备份

```bash
npm run db:backup -- <标签>       # 数据库备份
npm run account:password -- <邮箱> <新密码>  # 设置指定账号密码（运维一次性动作）
npm run state:backup -- <标签>    # 数据库 + 上传的联合备份（切换前必做）
npx prisma migrate deploy         # 只追加结构，不清空既有订单与消息
node scripts/restore-state.mjs <备份目录> <全新恢复目录>   # 恢复到全新目录，不覆盖源库
```

`state:restore` 的第二个参数是**必填**的恢复目标目录；只给标签会提示用法并退出，不会覆盖源库。备份目录形如 `prisma/backups/database-<标签>`，内含 `database.db`、`uploads/`、`manifest.json`。

规则：

1. 迁移只增量；回退走「上一发布版本 + 数据恢复」，**不执行破坏性回滚**。
2. 正式库升级前，先在数据库副本上演练同一个 `migrate deploy`。
3. 备份与上传目录必须同时备份、同时恢复；只恢复数据库会让图片与附件对不上。
4. 发布包排除：运行数据库及其 `-wal`/`-shm`、上传文件、`.env`、构建缓存、日志、Windows 依赖。

### 恢复演练（c14 实测通过）

每次大版本切换前做一次，全程不碰生产库：

1. `pm2 stop khui-ai` 停写 → `npm run state:backup -- drill-<标签>`，脚本自己输出 `integrity`、`foreignKeys` 与逐表行数。
2. `node scripts/restore-state.mjs prisma/backups/database-drill-<标签> /tmp/drill-restore-<标签>` 恢复到全新目录。
3. 对恢复出来的 `database.db` 跑 `pragma integrity_check`，行数要与第 1 步一致（本次：50 条迁移、18 用户、6 消息、16 订单）。
4. 用 `PORT=3101 DATABASE_URL=file:/tmp/drill-restore-<标签>/database.db` 起一个隔离实例，`/login`、`/chat`、`/shop`、`/square` 都要 200；确认无误后杀掉隔离实例、删掉临时目录与演练备份。
5. 最后 `pm2 start deploy/baota/ecosystem.config.js` 恢复生产，核对 `pm_cwd` 指向当前发布目录、`restarts` 为 0。

## 5.1 设置备份与恢复

设置不是配置文件，而是数据库里的三张表：`operation_settings`（公共值）、`user_setting_overrides`（用户特例）、`setting_revisions`（每次保存的历史版本）。三张表都在同一个 SQLite 文件里，所以**整库备份就是设置的完整备份**，不需要单独的设置备份脚本。

- 备份：`npm run state:backup -- <标签>`（数据库 + 上传联合备份）。`manifest.json` 与脚本输出的 `counts` 带逐表行数，含这三张表，恢复后先对行数。
- 恢复：`node scripts/restore-state.mjs <备份目录> <全新恢复目录>`，再按第 6 节切换发布。设置随库一起回到备份时刻，用户特例与历史版本一并回来。
- 只跑 `npm run db:backup -- <标签>` 也能覆盖设置本身，但上传对不上，日常仍用 `state:backup`。

### 只导出公共参数（不含用户特例与凭据）

跨环境搬运营参数时用设置中心的导出/导入，而不是搬整库：

| 动作 | 接口 | 权限 | 行为 |
|---|---|---|---|
| 导出 | `GET /api/admin/settings/export` | `settings.read` | 直接下载 `settings-<日期>.json`，结构 `{version, exportedAt, values}`。 |
| 导入预览 | `POST /api/admin/settings/import` | `settings.write` | 只算差异，不写库；每项标 `change` / `same` / `unknown-key`。 |
| 导入确认 | `POST /api/admin/settings/import/confirm` | `settings.write` | 一次事务写入，走与分组 PATCH 相同的 `saveChanges`。 |

导出文件里**只有登记表里的键的公共值**：

- 不含用户特例：导出按登记表逐项读公共值、不带 `userId`，`user_setting_overrides` 不可能被带出去。
- 不含凭据：AI 供应商密钥、支付商户凭据、数据库路径与上传目录都不在登记表里，它们存在各自的数据表或环境变量中。
- 不含历史版本：`setting_revisions` 不导出；导入写入的是新版本，历史照常追加。

导入的规则：只写真正变化的项（`same` 不写，不制造无意义的版本递增与历史噪音）；带 `expectedVersions` 做并发校验，别人先改过返回 409；文件里只要有一个未登记的键就**整批拒绝**，不做部分导入。

两条路的取舍：整库备份是「回到某一时刻」的完整恢复点（含用户特例、历史版本、订单与消息）；导出 JSON 是「把这套公共参数复制到另一个环境」，恢复后用户特例与凭据要各自另行处理。

## 5.2 后台任务启动

后台任务（摘要、结案、过期清理、对账、备份清理等七个巡检 kind）由应用进程自己拉起，不依赖外部调度：

- 入口是 `src/instrumentation.ts` 的 `register()`：`NEXT_RUNTIME === 'nodejs'` 时调用 `startTaskRunner()`（`src/lib/tasks/runner.ts`）。启动会打一条 `{"event":"background_task_runner_started"}`，运维从 `pm2 logs khui-ai` 确认它真的起来了，而不是只看后台页面有没有数据。
- 轮询：每轮先 `ensureSweepTasks()` 补齐巡检占位行，再 `runDueTasks()` 跑一批；每轮结束重新读 `tasks.intervalMs`（默认 `15000`），`tasks.batchSize`、`tasks.maxAttempts` 同样每轮现读，改设置不用重启进程。
- 租约在数据库里（120 秒），进程重启不丢：过期的 RUNNING 会被重新领取，别人持有的活租约不会被抢。部署是 PM2 单实例，重复调用只保留一个定时器。
- 单跑某个 kind：后台任务页的「立即执行」走 `runKindNow()`，与巡检共用 `handlers.ts` 一份分派表。
- `STORY_WORKER_DISABLED=1` 只停故事状态提取 worker，不影响上面这个任务入口。

外部计划任务：任务入口支持被宝塔计划任务调用——`node scripts/run-tasks.mjs` 一次性执行一批到期任务后退出，不在进程内常驻。调用方必须与 PM2 进程用同一份 `shared/app.env`（`DATABASE_URL` 指向同一个库）、以 `www` 身份执行，否则会去操作另一个库。当前默认仍是进程内轮询；外部计划任务入口见 `scripts/run-tasks.mjs`。

## 6. 发布流程（单机 Next + PM2 + Nginx）

1. **准备**：停写 → `npm run state:backup -- <标签>` 联合备份 → 在新版本目录 `npm ci && npx prisma generate && npm run verify:build`。
2. **副本演练**：数据库副本上 `npx prisma migrate deploy`，用备用端口（如 3100）接副本库启动，验证登录、权限、关键流程。
3. **发布**：`npm run release:check -- <生产库绝对路径>` → `npx prisma migrate deploy` → 按 `deploy/baota/ecosystem.config.js` 启动 PM2（进程名 `khui-ai`，单实例，`127.0.0.1:3000`，`NEXT_DIST_DIR=.next-build`）。
4. **断言**：HTTPS、登录、中文导航、后台权限、上传授权、支付关闭状态；关闭真实模型时聊天返回 503 是预期行为。
5. **观察**：`npm run test:production:guards` 与健康检查通过后 `pm2 save`。

PM2 必须使用项目独立目录：

```bash
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 list
```

跨发布目录时 `startOrReload` 可能仍指向旧目录，必须核对实际 `pm_cwd`。

## 7. 开关与回退

| 能力 | 关闭方式 | 关闭后的行为 |
|---|---|---|
| 聊天收费 | 设置中心 `billing.chargingEnabled=false` | 只停止新预扣；已 HELD 的费用单按实际结果结算或释放，不抹账本。 |
| 他眼中的你 | `mirror.enabled=false` | 入口隐藏，已生成结果仍可查看。 |
| 评理广场 | `dispute.enabled=false` | 停止新发起，已有案例按创建时写入的规则快照结束。 |
| 聊天记忆 | `memory.enabled=false` | 不再生成摘要与注入事实，已存在的数据保留。 |
| 真实支付 | `EZFP_ENABLED=false` | 下单入口关闭，历史订单与退款记录保留。 |

**重启后回退两版的坑（2026-10-22 实际踩到）**：PM2 由 `khui-ai-pm2.service` 以 `User=www`、`PM2_HOME=/www/wwwroot/khui-ai/shared/pm2` 拉起，开机执行 `pm2 resurrect` 读的是 `dump.pm2`。切换发布目录后如果没跑 `pm2 save`，机器一重启就回到 dump 里记录的旧目录（当时从 c15 退回 c13）。所以每次切换后必须 `pm2 save`，并确认 `grep -o "commercial-[a-z0-9-]*" $PM2_HOME/dump.pm2` 指向当前版本。另外不要用 root 直接 `pm2 start`：进程会变成 root 属主，而 `shared/database.db` 与 `shared/pm2` 都是 www 属主，后续以 www 启动时写 WAL 会失败。正确做法是 `systemctl restart khui-ai-pm2.service`。

回退：切换前保留上一发布目录与联合备份；需要回退时先停写，`state:restore` 恢复到全新目录，再一起切换代码、数据库、上传与配置。切换后已有新写入时，先保存现状与恢复来源，人工核对新增数据，禁止直接回旧库丢弃记录。

## 7.1 发布记录

| 发布 | 迁移 | 说明 |
|---|---|---|
| `commercial-20261022-c19` | 无 schema 变更（沿用第 51 条） | 当前线上版本：清理沉淀并把只存在于仓库、没有任何入口的运维脚本接进 npm——三个浏览器验收（后台导航置顶、成长引导、发现页场景）、故事评测结构校验、`release:pack`、`migrate:rehearse`；删一次性发布脚本 `.b17.sh` 与两个零引用导出（`hasAnyAdminEntry`、`hasCoinPriceRows`）；商城页自写的 `formatCny` 收敛到 `lib/format/number`。修两处脚本失效断言：邀请链接已改走 `/api/growth/invite/visit?code=` 落地口；场景验收缺 seed 时先报前置缺失。回退版本 `commercial-20261022-c18`；迁移前库副本 `shared/pre-c19.db`。 |
| `commercial-20261022-c18` | 第 51 条 `20261022140000_charge_request_hash_cancel_reason` | 上一版本：补齐 V3 三十二项规格缺口（计费幂等摘要与取消原因、七项定价快照版本、设置中心 96→109 键、财务五标签与订单详情抽屉、Mirror 观察风格与两套版式、账号导出与注销覆盖五个新对象、邀请与玩法漏斗补齐、任务运行入口与日志、前后台主题切换），测试 206 → 225 条；同时把一个已废弃的 `REPORT_RATE_LIMIT` 环境变量迁进设置中心。回退版本 `commercial-20261022-c17`；迁移前的库副本在 `shared/pre-c18.db`。 |
| `commercial-20261022-c17` | 第 50 条（无 schema 变更） | 上一版本：第四轮按 V3 表 25 收口（新增 docs/acceptance.md 八组验收记录、补用户覆盖三条用例与配置重启后仍保留的进程级证据、响应式补桌面档共 24 组、两个权限码接上真实闸门、删三条死路由与五个错路径常量、7 组重复字面量迁到常量、删零引用原语与整份死字典、收敛六组重复实现），测试 202 → 206 条；磁盘维持 15G。 |
| `commercial-20261022-c16` | 第 50 条（无 schema 变更） | 第三轮补缺口与拆分（财务页异常核对标签、后台通知统计页、Mirror 多角色对比、聊天链消息保存与结算合并为同一事务、13 个超 300 行文件拆到 300 行以内、六处重复实现收敛），测试 182 → 202 条；顺带清掉旧发布目录与线上缓存，磁盘从 29G 降到 15G。 |
| `commercial-20261022-c15` | 第 50 条（无 schema 变更） | 补齐 V3 第 14/15/23/24/25/26/28 章剩余缺口（工作台指标可点进列表并带日期、账号详情额度特例标签、Mirror 统计标签与 next/og 预览图、后台隐藏评理案例、记忆事实编辑与固定、四类通知生产者接上、五个任务可单独指定模型），测试 162 → 182 条；同时删掉不成立的「邮件找回」承诺文案、路径常量收进 api-paths。 |
| `commercial-20261022-c14` | 第 50 条（无 schema 变更） | 补齐 V3 剩余 8 项缺口（/square 广场入口、运营统计五项指标、成本换算与建议币价、后台导航置顶、一次点击一个 requestId、记忆待确认事实、评理撤回写侧、Mirror 题目与示例结果），测试 140 → 162 条；同时把四处重复的 `formatDateTime` 收敛到一处、`price-cost-admin.tsx` 542 → 280 行。 |
| `commercial-20261022-c13` | 第 50 条 `20261022020000_growth_billing_gaps` | 补齐 V3 剩余 12 项缺口（取消计费策略、聊天页费用展示、Mirror IP 通道与推广名单、AI 任务预算、玩法埋点与漏斗、邀请与新手引导、设置导出导入与提示词试生成、评理奖励、每日自动备份），测试 64 → 140 条。 |
| `commercial-20261021-c12` | 第 49 条（无 schema 变更） | 在 c11 基础上收口 Mirror 与评理的 6 处实战缺陷，测试 59 → 64 条。 |
| `commercial-20261021-c11` | 第 49 条 `20261021180000_commercial_platform` | 首个商业版：设置中心、计费、Mirror、评理、记忆、后台任务、站内通知、六个后台分组。 |
| `commercial-20261021-c9` | 第 48 条 | 上一版本，保留用于回退。 |

切换时的顺序与实测要点：

1. 用 `sqlite3 <库> ".backup '<副本>'"` 复制生产库（库在 WAL 模式，直接 `cp` 会丢未 checkpoint 的写入）。
   正式库迁移前必须 `pm2 stop khui-ai`：应用持有 WAL 连接时 `migrate deploy` 直接报 `database is locked`。
2. 副本上 `npx prisma migrate deploy`，核对行数与 `pragma integrity_check`，再用 3100 端口接副本启动一次。
3. 正式库：`pm2 stop khui-ai` → `npm run state:backup -- <标签>` → `npx prisma migrate deploy` → `npm run release:check -- <生产库>`（要求 `compatible:true`）。
4. 新目录 `npm ci`（**不要加 `--omit=dev`**：构建与 `release:check` 需要 `tsx`、`typescript`）→ 建 `.env` 软链到 `shared/app.env`（缺了构建期查库会 P1008）→ `npm run build`。
   构建产物要落在 `NEXT_DIST_DIR=.next-build`；`npm run verify:build` 写的是 `.next-validation-build`，两者不是同一个目录，别拿校验产物当发布产物。
5. `pm2 delete khui-ai` 再 `pm2 start deploy/baota/ecosystem.config.js`：跨发布目录时 `startOrReload` 可能仍指向旧目录，必须核对 `pm_cwd`。
5.1 `chown -R www:www <发布目录>`：发布包以 root 解开、构建也以 root 跑，而 PM2 以 `www` 运行。不改属主时进程仍能启动、页面也正常，但 Next 写不了 `.next-build/server/route-cache`，日志里持续出现 `EACCES: permission denied, mkdir .../route-cache`，预渲染缓存全程失效。判据：`ls -ld <发布目录>/.next-build` 应为 `www www`，且启动后 `route-cache/` 由 `www` 创建。
6. 断言：`/api/admin/session` 权限码数量、`/api/admin/{settings,tasks,mirror/results,disputes/cases,billing/charges,ai/coin-prices}` 全部 200、设置 PATCH 写入后读回一致且历史留痕。

## 8. 验收与回归

| 命令 | 覆盖 |
|---|---|
| `npx tsc --noEmit` | 类型检查（0 错误为通过） |
| `npm run test:notifications` | 站内通知：未读计数、标记已读、跳转字段、同事件不重复 |
| `npm test` | API 端到端测试跑（需先启动被测服务） |
| `npm run test:browser` | 浏览器关键流程矩阵 |
| `npm run test:production:guards` | 生产守卫检查 |
| `npm run test:commercial` | 商业改造十个域：设置运行时、计费（含取消策略）、Mirror、评理（含奖励）、通知、后台任务、后台商业接口、玩法埋点、增长邀请与引导、AI 任务预算 |
| `npm run test:clean` | 列出（加 `--apply` 删除）验收脚本遗留的一次性数据库 |

静态检查只覆盖改动文件与受影响调用方；不为一个设置改动跑全站。
