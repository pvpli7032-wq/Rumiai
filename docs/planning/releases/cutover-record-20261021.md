# 生产切流记录：commercial-20261021-c5

> 本记录只写已发生事实，不补写未发生的步骤。来源为本次切流核实结果与交接事实。

## 结果摘要

| 项 | 实测结果 |
|---|---|
| 发布目录 | `commercial-20261021-c5` |
| 生产迁移 | 48 条 |
| PM2 | online；restarts=0；exec cwd 指向 c5 |
| PM2 持久化 | `pm2 save` 已执行 |
| Soak | 60 秒内 12/12 请求返回 200 |
| 回滚位 | `c2`、`c3`、`c4-rc2` 保留 |
| BUILD_ID | 以服务器 `.next-build/BUILD_ID` 为准；本记录不臆填具体值 |

## 时间线与门判据

| 阶段 | 门判据 | 实测/结果 |
|---|---|---|
| 发布候选目录 | 新 release 目录可用 | `commercial-20261021-c5` 作为目标 release |
| 数据库迁移 | 迁移完成且生产库可用 | 48 条迁移；最终生产状态通过 |
| PM2 切换 | 应用进程在线，cwd 指向目标 release | online，restarts=0，exec cwd=c5 |
| 持久化 | PM2 进程表保存 | `pm2 save` 已完成 |
| 稳定性观察 | 60 秒请求观察 | 12/12 返回 200 |
| 回滚准备 | 旧 release 仍可定位 | `c2`、`c3`、`c4-rc2` 保留 |

## 两次失败与处置

### 失败 A：占位空库构建

- 现象：使用占位空库构建，构建过程缺少 `tags` 表，导致构建失败。
- 处置：停止沿用占位空库构建路径，改用包含实际 schema 的生产数据/隔离库路径后继续。
- 记录边界：本记录确认失败现象和处置，不推断额外命令或未发生的回滚。

### 失败 B：PM2 cwd 未刷新

- 现象：对旧 app 使用 `start --update-env` 后，PM2 的旧 `exec cwd` 未随新 release 刷新。
- 处置：执行 `pm2 delete`，再从 `commercial-20261021-c5` 的 ecosystem 重建 PM2 app；随后核对 cwd。
- 结果：PM2 online，restarts=0，exec cwd 指向 c5；之后执行 `pm2 save`。

## 结论

c5 已上线生产。48 条迁移、PM2 online/restarts 0/cwd=c5、`pm2 save` 和 60 秒 12/12 200 均已核实；回滚位 `c2`/`c3`/`c4-rc2` 保留。未在本记录中增加未核实的时间戳、BUILD_ID、备份路径或命令输出。

---

# 生产切流记录：commercial-20261021-c6（2026-10-21）

> 同一批次的第二次切流：把 c5 之后提交的 4 项带上生产（worker 启动日志、`story:publish` 工具与试点内容、M4 记忆闭环 buildContext、失效钩子注释修正）。

## 结果摘要

| 项 | 实测结果 |
|---|---|
| 发布目录 | `commercial-20261021-c6` |
| 生产迁移 | 48 条（与 c5 相同，本批无新迁移） |
| PM2 | online；exec cwd 指向 c6；`pm2 save` 已执行；restarts=1（属修复属主后的**主动** `pm2 restart`，非崩溃重启；unstable restarts=0） |
| 数据库 | `users=14 / deleted=9 / live=5`、`story_runs=0`、`story_templates=1`、`conversations=3`、`messages=6` |
| 预切备份 | `shared/backups/pre-c6-20261021-084806`，`integrity_check=ok` |
| worker | 启动日志 `{"event":"story_state_worker_started","intervalMs":15000}` 已在 out 日志出现 |
| 端到端 | 注册→登录→匿名拒绝→建实例(201)→幂等重放同 id→详情无私有字段→缺 requestId 422→列表→注销，11/11 PASS |
| Soak | 20/20 请求 200；`/zh`、`/zh/explore`、`/admin` 均 200，匿名 `/api/story-runs` 401 |
| 回滚位 | `c2`、`c3`、`c4-rc2`、`c5` 保留 |

## 与 c5 的差异

本批**无 schema 变更**，48 条迁移与 c5 一致。代码/内容差异共 28 个文件：

- 新增：`src/lib/stories/lifecycle/context-service.ts`、`scripts/publish-story-template.mjs`、`content/stories/xingban-original-0-ch1.json`、`tests/story-context.test.mjs`、`tests/story-template-publish.test.mjs`、`docs/planning/releases/cutover-record-20261021.md`
- 修改：`chat-stream.ts`、`turn-service.ts`、`state-worker.ts`、`instrumentation.ts`、`invalidation.ts`、`package.json`（`story:publish`）、三篇内容草稿与 `review-ch1-6.md`、评测 catalog/executor

## 本批的两次失败与处置

### 失败 C：整包上传在本机不可行

- 现象：`scp` 传 1.3 MB 整包与 300 KB 探针均超时；64 KB 分片则 2 秒内成功。链路对大文件持续传输不稳定。
- 处置：改为「服务器上 `cp -a c5 c6` 复制含 node_modules 的完整树（1.1 G），再用 86 KB 的增量包覆盖 28 个文件」。避免重跑 `npm ci` 与重复下载。
- 记录边界：这不改变发布内容——增量包里的每个文件都与本地 c6 打包产物逐字节一致。

### 失败 D：构建产物属主导致运行时缓存写入失败

- 现象：c6 的 `.next-build` 由 root 构建，运行时 `next-server`（www）写 `server/route-cache` 报 `EACCES`。
- 处置：`chown -R www:www` 整个 release 目录后重启；重启后 `route-cache` 相关报错计数不再增加（18→18）。
- 记录边界：该错误不影响页面返回（探活全程 200），但会持续污染 error 日志并丢失缓存，必须修。

## 结论

c6 已上线生产（服务器 `.next-build/BUILD_ID` = `dAyjVHVYk17AzkwYF52Ca`）。48 条迁移、PM2 online/cwd=c6、`pm2 save`、11/11 端到端、20/20 soak 均已核实；`users live=5` 与切流前一致，探针账号 6 个全部走产品注销接口关闭（未用 SQL 直改生产库）。回滚位 `c2`/`c3`/`c4-rc2`/`c5` 保留。

---

# 生产切流记录：commercial-20261021-c7（2026-10-21）

> 第三次切流：把故事体验闭环带上生产——公开故事目录、故事入口页、/chat 故事模式，外加两个被浏览器矩阵暴露的真问题修复。

## 结果摘要

| 项 | 实测结果 |
|---|---|
| 发布目录 | `commercial-20261021-c7` |
| 生产迁移 | 48 条（本批无 schema 变更） |
| PM2 | online；exec cwd=c7；restarts=0；`pm2 save` 已执行 |
| BUILD_ID | `jlFSSfsXPxlXR1bXDknjp` |
| 预切备份 | `shared/backups/pre-c7-20261021-123614`（`sqlite3 .backup` + `integrity_check`） |
| 端到端 | 19/19 PASS（见下） |
| Soak | 20/20 返回 200 |
| 数据 | `users=16 / deleted=11 / live=5`、`story_runs=0`、`story_templates=1`、`conversations=3`、`messages=6` |
| 回滚位 | `c2`、`c3`、`c4-rc2`、`c5`、`c6` 全部保留 |

## 本批内容（19 个文件，增量包 SHA256 `5b991bff…73a8`，本地与服务器一致）

新增：`catalog-service.ts`、`api/stories/route.ts`、`api/stories/[slug]/route.ts`、`(app)/stories/[slug]/page.tsx`、`components/stories/story-entry-page.tsx`、`components/chat/story-mode.tsx`、`scripts/verify-story-browser.mjs`、`tests/story-catalog.test.mjs`。
修改：`chat/page.tsx`（+9/−1，仅分支挂载）、`middleware.ts`、`message-service.ts`、`run-service.ts`、`package.json`、矩阵与导出脚本、locale-middleware 与 conversation-message 用例、两份交接文档。

## 端到端实测（19 项全过）

匿名目录 200 → 目录/详情 JSON 均无 `hiddenFacts`/`definitionJson`/`characterSnapshotJson`/`stateJson` → 未知 slug 404 → 入口页 200 → 注册 201 拿 token → 匿名建 run 401 → 建 run 201 → 同 requestId 幂等返回同 id → 详情 200 且无私有字段、不投影消息正文 → 缺 requestId 422 → 注销 200。

页面：`/zh`、`/zh/explore`、`/zh/about`、`/admin`、`/stories/xingban-original-0-ch1` 全 200。`/zh/stories/…` 404 符合预期——故事入口按规划书 TABLE 5 挂在 `/stories/[slug]`，不在 locale 段下。

## 本批修掉的两个真问题

### middleware 把 `/` 重定向到 localhost:3000

- 现象：隔离实例上 Chromium 打开 `/` 报 `ERR_CONNECTION_REFUSED`，而 Node 的 fetch 拿到 307 且 `location: http://localhost:3000/zh`。
- 根因：`src/middleware.ts` 用 `SITE_URL`（来自 `NEXT_PUBLIC_SITE_URL`）拼 `location`，而 Next 在**构建期**内联 `NEXT_PUBLIC_*`，运行期设置的值被忽略。
- 处置：改为按请求推导来源——`x-forwarded-host`/`x-forwarded-proto`，回退 `host`，再回退 `request.nextUrl.origin`。补了两条回归用例（带 forwarded 头需保持公网源；无配置时须用请求自身源）。
- 生产侧影响为零：nginx 一直传 `x-forwarded-host`，线上 `/` 仍是 307 → `https://lh.y-98.cn/zh`（切流前后各测一次，一致）。

### 账号导出断言停在 v2

- 现象：`test:m5:export:browser` 报 `3 !== 2`。
- 根因：M4 给导出加了 stories 区块，版本升到 v3，浏览器脚本的断言没跟着改；`tests/account-data-export.test.mjs` 早已是 3。
- 处置：断言改到 3 并补故事区块存在性检查。

## 本批的传输处置

`scp` 在本机对 50 KB 以上的文件持续超时（同一文件 `ssh 'cat > file'` 走 stdin 一次成功）。整批改为：`ssh … 'cat > /tmp/x'` 上传增量包 → 远端校验 sha256 → `cp -a c6 c7` → 解包 → 构建 → `chown -R www:www` → PM2 重建。远端脚本用 `setsid nohup` 脱离会话运行，避免 ssh 断开时被带走。

## 结论

c7 已上线生产。故事目录、入口页、故事会话三处对匿名/注册用户均可用；19/19 端到端与 20/20 soak 通过；`users live=5` 与切流前一致，探针账号全部走产品注销接口关闭。回滚位 `c2`/`c3`/`c4-rc2`/`c5`/`c6` 保留。
