# M5 试点发布 Runbook（R4 试点：M3+M4 合并上线 / 灰度窗口 / 降级与回滚）

> 依据 `docs/planning/HANDOFF.md` 第 1/7 节、`docs/planning/roadmap.md` R4 批次行与发布固定操作门、规划书第 22/27 章口径整理。
> 所有命令只在发布窗口内由部署操作者在服务器执行；本 runbook 的编写与脚本验证均未连接生产。
> 风格与流程骨架沿用 `docs/planning/releases/m3-launch-runbook.md`；灰度开关设计见 `docs/planning/releases/story-rollout-flags.md`。

## 0. 适用范围与红线

- 适用：把 `commercial-refactor` 分支的 M3（数据模型 + 回合编排）+ M4（记忆与章节闭环 + worker）+ M5 生命周期发布到生产，并进入 R4 灰度观察。
- 红线：
  - 不覆盖旧发布目录、共享库、`shared/app.env`、`shared/uploads`；
  - 正式库只允许 `npx prisma migrate deploy`，禁止 `db:push` / `db:init` / reset / 任何手工 DDL；
  - 迁移未在副本演练通过前，不进入发布窗口；PM2 切换未完成断言前，不 `pm2 save`；
  - 回滚顺序固定：**先关 worker / 写入，再切回旧应用**（见 §6 Phase E）；不为回退删除新增表；
  - 出现本 runbook 未覆盖的异常时停止并上报，不即兴发挥；数据安全问题（权限越界、备份不可读、外泄）即停。
- 本机（Windows）不跑 `prisma migrate deploy`：schema-engine 二进制在受限环境被拦（见 `scripts/helpers/create-isolated-db.mjs` 头注释与 M4 终验记录 §2.2），隔离库验证一律走 `create-isolated-db.mjs` / `rehearse-migration.mjs`。

## 1. 背景与前置状态核对（发布前必做）

| 项 | 值（以窗口日实际核对为准） |
|---|---|
| 本地代码基线 | `commercial-refactor` 分支，M3+M4+M5 文档已合入（M4 闭环起点 `0e72f85`，当前 HEAD `ed0cd03`） |
| 本地迁移总数 | 47 条（45 条生产既有 + `20261020120000_story_run_contract` 6 张 story 表 + `20261020150000_scene_funnel_events` 1 张埋点表），均纯增量 |
| 当前生产发布 | `releases/commercial-20261020-c4-rc2`（BUILD_ID `tRBseGKiU88NSsGiOCagr`） |
| PM2 | 单实例 `khui-ai`，www 身份，仅监听 `127.0.0.1:3000`，`PM2_HOME=/www/wwwroot/khui-ai/shared/pm2` |
| 生产库 | `/www/wwwroot/khui-ai/shared/database.db`，当前 45 条迁移 applied |
| 回滚位 | `c3`、`c2` 目录保留；本次新增回滚位 = `c4-rc2` |
| worker 事实 | `c4-rc2` 旧应用**没有** state worker；新应用 worker 由 `src/instrumentation.ts` 启动，`STORY_WORKER_DISABLED=1` 可跳过（已实现，提交 `ed0cd03`） |

### 前置分支核对（二选一，写进操作记录）

| 情形 | 判据（`npm run release:check` 对生产库） | 本 runbook 执行方式 |
|---|---|---|
| 情形 1：M3 runbook 已执行 | `pendingCount=0, unexpectedCount=0, failedCount=0`，库 47 条 | §5 Phase C 跳过 C4 正式迁移，其余照常 |
| 情形 2：M3 runbook 未执行（M3+M4 一次窗口合并上线） | `pendingCount=2, unexpectedCount=0, failedCount=0` | §5 Phase C 完整执行含 C4；批次取舍见 `docs/planning/releases/m3-m4-release-checklist.md` |

**禁止情形**：`unexpected>0` 或 `failed>0` —— 库状态与预期不符，终止上线，不得强行迁移。

## 2. 发布窗口前准备（低风险，可提前做）

### R0 给回滚位补迁移文件（只补文件，不执行 SQL）

若生产库仍是 45 条（情形 2），先把两条新迁移**目录**复制进 `c4-rc2` 的 `prisma/migrations/`（与 M3 runbook §2 R0 相同）：

```sh
cp -r /www/wwwroot/khui-ai/releases/<新发布目录>/prisma/migrations/20261020120000_story_run_contract \
      /www/wwwroot/khui-ai/releases/commercial-20261020-c4-rc2/prisma/migrations/
cp -r /www/wwwroot/khui-ai/releases/<新发布目录>/prisma/migrations/20261020150000_scene_funnel_events \
      /www/wwwroot/khui-ai/releases/commercial-20261020-c4-rc2/prisma/migrations/
```

- 成功判据：`ls /www/wwwroot/khui-ai/releases/commercial-20261020-c4-rc2/prisma/migrations | wc -l` = 47（不含 `migration_lock.toml`）；**不执行任何 SQL**，`c4-rc2` 的代码不引用新表，行为不变。
- 失败处理：找不到新发布目录说明 §4 Phase B 未完成，先走 Phase B。
- 若 M3 runbook 已执行过（情形 1），此步应已存在，核对即可。

### R1 变量表

执行前把下列值定死并抄进操作记录：

| 变量 | 建议值 |
|---|---|
| `<RELEASE>` | `commercial-YYYYMMDD-c5`（日期取发布日） |
| `<BACKUP-PRE>` | `m4-pre-<YYYYMMDD>`（演练源备份） |
| `<BACKUP-FINAL>` | `m4-final-<YYYYMMDD>`（停写后正式回滚点） |
| 维护窗口 | 与产品/客服约定；窗口外不执行 §5 |
| 告警责任人 | M5 观察期内 5xx / worker / 成本告警的第一响应人（roadmap M5 退出条件：告警责任人就位），窗口前写明姓名与联系渠道 |
| 灰度开关默认值 | 窗口日默认全开（试点规模）或按 `story-rollout-flags.md` 起始档位；旗标未实现前以"试点用户名单 + 手工停写"替代，见 §6 E1/E2 |

### R2 冻结与告知

按 roadmap 发布固定操作门第 1 条：冻结 SHA、迁移清单、开关默认值、负责人和窗口。操作记录至少包含：`git rev-parse HEAD`、`node scripts/pack-release.mjs` 输出 JSON、窗口起止时刻、执行人。

## 3. Phase A：本地构建与打包（零风险，全部在本机）

### A1 验证基线

```sh
npx tsc --noEmit
npm run verify:done
npm run test:production:guards
node --import tsx --test tests/story-run-service.test.mjs tests/story-turn-service.test.mjs tests/story-lifecycle-service.test.mjs
node --import tsx --test tests/chat-application-service.test.mjs tests/conversation-message.test.mjs tests/conversation-service.test.mjs
node tests/m0-route-behavior.test.cjs
node --test tests/m2-context.test.cjs
node --import tsx --test tests/stories-v0.test.mjs
npm run test:m5:backup
npm run test:m5:state-backup
npm run test:m5:export
npm run test:m5:closure
npm run test:m5:recovery-runtime
node --import tsx --test tests/story-state-quota.test.mjs
node --import tsx --test tests/database-upgrade.test.mjs
node --import tsx --test tests/scene-funnel-events.test.mjs
node scripts/verify-story-eval.mjs run        # 评测口径：PASS=15 FAIL=0 PENDING=44 BLOCKED=1（M4 终验基线）
DISABLE_MOCK_AI=false node scripts/run-browser-matrix.mjs test:browser    # PASS=9 SKIP=1 FAIL=0
```

- 成功判据：全部退出码 0；`test:m5:*` 系列按 roadmap R4 验收命令逐条通过；真实模型评测 `npm run test:real-ai` 仅在**获显式授权**（`STORY_EVAL_ALLOW_REAL_MODEL=1`）后执行，结果记入操作记录，不作为窗口硬门禁。
- 失败处理：修复后重跑；**基线不过不放行打包**。
- 注意：`npm test`（tests/runner.ts）要求 localhost:3000 有服务、`test:m2:chat` 硬要求 18782 端口，均不列入本 runbook（HANDOFF §5 既有说明）。

### A2 构建

```sh
npm run build
npm run verify:build
```

- 成功判据：`next build` 退出 0（产物在 `.next-build/`）；`verify:build` 在独立空库上完成 47 条迁移 + 生产构建验证。
- 失败处理：按构建报错修复；确认 `prisma/.local` 无残留锁（`npm run test:clean`）。

### A3 打包

```sh
node scripts/pack-release.mjs <RELEASE> --tar
```

- 成功判据：输出 JSON，`checks:"ok"`、`migrations:47`、`tar.bytes` 与 staging 一致；产物在 `artifacts/release-packs/<RELEASE>/`。
- 失败处理：同 M3 runbook §3 A3（旧包人工确认后删除重打、排除物清理、tar 失败改手工压缩）。
- 注意：打包的是**当前工作区**。M5 文档提交后工作区应只剩 `docs/planning/**` 与本 runbook 增量；确认无未完成的业务改动混入，A1 基线跑在打包前一刻。

### A4 本地迁移演练（本地自证，可随时重跑）

```sh
node scripts/rehearse-migration.mjs
```

- 成功判据：JSON `mode:"local-baseline"`、`migrations:{appliedCount:47,availableCount:47,pendingCount:0}`、`integrity:"ok"`、`foreignKeys:"ok"`、`countsPreserved:true`、`newTables` 含 6 张 story 表 + 1 张 `scene_funnel_events`。
- 失败处理：演练失败即迁移有问题，**绝对不进窗口**；把 JSON 报错交 software-architect。

## 4. Phase B：服务器预装、副本演练与 3100 预启动（不停写、不切流）

### B1 上传解压 + 原生安装构建

```sh
tar -xzf <RELEASE>.tar.gz -C /www/wwwroot/khui-ai/releases/
cd /www/wwwroot/khui-ai/releases/<RELEASE>
npm ci
npx prisma generate
npm run verify:build
```

- 成功判据：`npm ci` 无 error；`verify:build` 退出 0（独立空库验证 47 条迁移 + 生产构建）。
- 失败处理：依赖或构建失败 → 修复重传；不得在旧目录里凑合。

### B2 预备份（演练源）

在新发布目录执行（`app.env` 通过目录内链接加载）：

```sh
npm run state:backup -- <BACKUP-PRE>
```

- 成功判据：输出 JSON `integrity:"ok"`、`foreignKeys:"ok"`，`uploads` 计数与清单一致；产物在 `<RELEASE>/prisma/backups/database-<BACKUP-PRE>-*/database.db`。
- 失败处理：备份失败 = 不具备上线条件，停止并保留现场。

### B3 副本迁移演练

```sh
node scripts/rehearse-migration.mjs /www/wwwroot/khui-ai/releases/<RELEASE>/prisma/backups/database-<BACKUP-PRE>-*/database.db
```

- 成功判据：JSON `mode:"production-copy"`、`appliedNow` 恰好列出两条新迁移（情形 2）或空列表（情形 1）、`migrations.appliedCount=47`、`integrity/foreignKeys ok`、`countsPreserved:true`。
- 失败处理：任何断言失败 → 终止上线；保留 `KEEP_TEST_DB=1` 现场交 software-architect。演练通过前**绝不**对 `shared/database.db` 执行迁移。

### B4 3100 预启动（接副本库，含 worker 双态验证）

```sh
cd /www/wwwroot/khui-ai/releases/<RELEASE>
cp <演练副本> prisma/.local/prestart.db
mkdir -p prisma/.local/uploads && cp -r /www/wwwroot/khui-ai/shared/uploads prisma/.local/uploads-prod-copy

DATABASE_URL=file:/www/wwwroot/khui-ai/releases/<RELEASE>/prisma/.local/prestart.db \
  node scripts/start-production.mjs --check-only

NEXT_DIST_DIR=.next-build UPLOADS_DIRECTORY=/www/wwwroot/khui-ai/releases/<RELEASE>/prisma/.local/uploads-prod-copy \
  DATABASE_URL=file:/www/wwwroot/khui-ai/releases/<RELEASE>/prisma/.local/prestart.db \
  npx next start --hostname 127.0.0.1 --port 3100 &
```

- `--check-only` 先跑启动门禁（`assertReleaseCompatible`），打印 `release_migrations_compatible` 后退出；
- 直接 `npx next start` 必须显式 `NEXT_DIST_DIR=.next-build`；
- worker 双态验证（M5 新增）：a) 默认启动日志应出现 worker 启动迹象（正常处理 PENDING 为空、不报错）；b) 在同一端口用 `STORY_WORKER_DISABLED=1` 前缀再起一次，确认日志无 worker 启动且站点冒烟仍全 200 —— 这是窗口后降级路径（§6 E1）的预验证。
- 成功判据（冒烟，全部满足）：

  ```sh
  curl -s -o /dev/null -w '%{http_code} ' http://127.0.0.1:3100/zh            # 200
  curl -s -o /dev/null -w '%{http_code} ' http://127.0.0.1:3100/discover     # 200
  curl -s -o /dev/null -w '%{http_code} ' http://127.0.0.1:3100/shop         # 200
  curl -s -o /dev/null -w '%{http_code} ' http://127.0.0.1:3100/api/site     # 200
  curl -s -o /dev/null -w '%{http_code} ' http://127.0.0.1:3100/admin        # 200
  curl -s -o /dev/null -w '%{http_code} ' http://127.0.0.1:3100/login        # 200
  curl -s -o /dev/null -w '%{http_code} ' http://127.0.0.1:3100/api/admin/access  # 401
  curl -s -o /dev/null -w '%{http_code} ' http://127.0.0.1:3100/api/v1/site  # 404
  ```

  进程日志无 error 堆栈；worker 双态均符合。
- 失败处理：任一断言不符 → 停止 3100 进程，终止上线，保留日志。冒烟通过后 `kill` 该进程并确认 3100 已释放。

## 5. Phase C：发布窗口（停写 → 备份 → release:check → 迁移 → PM2 切换 → 断言 → 观察）

### C1 停写

停掉全部业务写入：后台"业务只读维护"**不**拦截管理写入与进行中请求，只能作为辅助；须确认无进行中的聊天回合、上传清理与结算任务。

M5 特有：确认生产库此时**不存在**进行中的故事回合（情形 1 下生产可能已有 StoryRun）：无进行中回合、无 PENDING/PROCESSING 状态残留（旧应用无 worker，若有 PENDING 残留说明 M3 批次后曾有 worker 在跑，先查明再继续）。

- 成功判据：操作记录写明停写时刻与确认人。
- 失败处理：无法确认写入静默 → 推迟窗口。

### C2 终备份（正式回滚点）

```sh
npm run state:backup -- <BACKUP-FINAL>
```

- 成功判据：同 B2；此备份是迁移的正式回滚点。
- 失败处理：备份失败 → 放弃本次窗口，恢复写入，另行排期。

### C3 迁移前 release:check

```sh
npm run release:check -- /www/wwwroot/khui-ai/shared/database.db
```

- 成功判据：**预期失败**，但 JSON 必须是 `pending=2, unexpected=0, failed=0`（情形 2）或 `pending=0, unexpected=0, failed=0`（情形 1，此命令退出码 0）。出现 `unexpected>0` 或 `failed>0` → 停止。
- 失败处理：按 JSON 报告核对 `_prisma_migrations`；不得强行迁移。

### C4 正式迁移（情形 2 才执行；情形 1 跳过）

```sh
npx prisma migrate deploy
```

- 成功判据：输出显示应用 2 条迁移；`_prisma_migrations` 完成数 = 47。SQLite 下单条迁移整体事务化，失败自动回滚。
- 失败处理：迁移报错 → **不启动新代码**，PM2 旧版继续跑（45 迁移与旧代码兼容）；保留报错现场，按 §6 E5 处置。

### C5 迁移后 release:check（必须完全兼容）

```sh
npm run release:check -- /www/wwwroot/khui-ai/shared/database.db
```

- 成功判据：退出码 0，JSON `compatible:true, pendingCount:0, unexpectedCount:0, failedCount:0`。
- 失败处理：不切换 PM2；按 §6 E5。

### C6 PM2 切换

```sh
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 describe khui-ai | grep cwd
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 delete khui-ai
cd /www/wwwroot/khui-ai/releases/<RELEASE>
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 start deploy/baota/ecosystem.config.js
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 describe khui-ai | grep cwd   # 必须指向 <RELEASE>
```

- 成功判据：`pm_cwd` 指向 `<RELEASE>`；状态 online；启动日志出现 `release_migrations_compatible` 与 `sqlite_wal_ready`（启动门禁通过），且 state worker 正常启动（无 STORY_WORKER_DISABLED）。
- 失败处理：启动门禁失败或 online 起不来 → 按 §6 E3 立即回滚。

### C7 断言（公网，M5 扩充版）

基础断言（同 M3 runbook D7）：

```sh
curl -s -o /dev/null -w '%{http_code} ' https://lh.y-98.cn/zh        # 200（/ 307 到 /zh）
curl -s -o /dev/null -w '%{http_code} ' https://lh.y-98.cn/discover  # 200
curl -s -o /dev/null -w '%{http_code} ' https://lh.y-98.cn/shop      # 200
curl -s -o /dev/null -w '%{http_code} ' https://lh.y-98.cn/api/site  # 200
curl -s -o /dev/null -w '%{http_code} ' https://lh.y-98.cn/admin     # 200
curl -s -o /dev/null -w '%{http_code} ' https://lh.y-98.cn/login     # 200
curl -s -o /dev/null -w '%{http_code} ' https://lh.y-98.cn/api/admin/access  # 401
curl -s -o /dev/null -w '%{http_code} ' https://lh.y-98.cn/api/v1/site       # 404
```

M5 新增断言（登录态浏览器执行，逐条记录）：

| # | 操作 | 预期 |
|---|---|---|
| M1 | 管理员登录一次 | 成功 |
| M2 | 发一条普通聊天消息走通（无 StoryRun 会话） | 正常回复，SSE 正常；确认普通路径零变化 |
| M3 | 试点名单内用户创建一个故事实例（POST /api/story-runs） | 201；列表可见 |
| M4 | 该实例发一个故事回合（POST /api/story-runs/[id]/turns） | SSE 序列 accepted/deltas/committed/state_pending/done；消息落库 |
| M5 | 等待 worker 整理完成 | stateStatus 从 PENDING → 已处理；无 FAILED |
| M6 | 试点名单外普通用户访问故事入口 | 按 story-rollout-flags.md 起始档位预期（未开放则不可见/404），不出现 5xx |
| M7 | 管理端漏斗报表页 | 四比率聚合正常渲染，无 500 |
| M8 | 匿名 curl 故事 API 边界 | `/api/story-runs` 401；不存在实例 404（按 api-paths 约定） |

- 成功判据：以上全部符合。
- 失败处理：基础断言任一不符 → §6 E3；M5 新增断言不符（基础断言全过）→ §6 E1/E2（先降级，不必立即切回）。

### C8 观察 + 保存进程表

```sh
sleep 60
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 list
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 logs khui-ai --lines 50 --nostream
```

- 成功判据：60 秒内 `restarts` 计数不变、内存稳定、日志无 error 刷屏；worker 无 FAILED/STATE_DATA_CORRUPT 刷屏；SQLite 无锁等待报错。
- 失败处理：反复重启 → §6 E3；worker 异常但站点正常 → §6 E1。
- 全部通过后 `pm2 save`（**此前绝不 save**），恢复写入，发布窗口关闭。
- 窗口关闭 ≠ 试点结束：进入灰度观察期，指标与扩量/暂停决策按 `docs/planning/releases/story-rollout-flags.md` §3/§4 执行（roadmap 发布固定操作门第 4 条：观察 5xx、写入错误/延迟、worker 租约、SQLite 锁等待、费用和旧聊天回归）。

## 6. Phase E：降级与回滚

> 顺序红线：**先关 worker / 关写入，再切回旧应用**（规划书第 27 章回退操作 + roadmap 操作门第 5 条）。故事开关关闭不得触发重复扣费或退款；不为回退直接删除新增表。

### E0 决策门

| 触发 | 动作 |
|---|---|
| 站点级故障（5xx 刷屏、反复重启、启动门禁失败） | 直接 E3 |
| worker 异常（FAILED 积压、STATE_DATA_CORRUPT、租约滞留），站点正常 | E1（停 worker），保留新应用在线 |
| 故事新入口问题（创建/回合/结章报错扩散），普通聊天正常 | E2（关写入），保留新应用在线 |
| 数据安全问题（权限越界、备份不可读、外泄） | 立即停写 + E1 + E2，然后按 E3/E4 处置并上报 |

### E1 软降级：停 worker（不切应用）

```sh
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 delete khui-ai
cd /www/wwwroot/khui-ai/releases/<RELEASE>
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 \
  STORY_WORKER_DISABLED=1 /usr/bin/pm2 start deploy/baota/ecosystem.config.js
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 logs khui-ai --lines 30 --nostream
```

- 语义：state worker 停止（`src/instrumentation.ts` 启动前检查跳过），状态整理、结章后的自动整理全部暂停；已提交消息与回复保留；故事会话可继续收发但 stateStatus 停留 PENDING（不伪装连续剧情，符合第 27 章"暂停 worker 和新故事推进，保留记录"）。
- 成功判据：online；日志无 worker 启动；普通聊天冒烟 200；`pm2 save`。
- 失败处理：起不来 → E3。
- 注意：`STORY_WORKER_DISABLED=1` 必须作为进程环境变量传入（经 ecosystem.config.js 继承），恢复时 delete 后**不带**该变量重启。

### E2 关写入：停新故事推进（旗标未实现期的手工替代）

灰度旗标（`STORY_RUNS_DISABLED` 等）按 `story-rollout-flags.md` 设计，**实现待批准后另立任务**。旗标未实现期间的手工顺序：

1. 产品侧下架故事新入口（前台不可见）；
2. 停写窗口内核实无进行中回合（`story_turns` 无 PENDING/PROCESSING 新增）；
3. 此后如仍需彻底静默写入，按 C1 停写口径执行。

- 成功判据：新入口不可达或返回友好关闭提示；存量故事记录只读保留；无重复扣费/退款副作用。
- 失败处理：入口下不了 → E3。

### E3 切回旧应用（无新增故事写入时）

```sh
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 delete khui-ai
cd /www/wwwroot/khui-ai/releases/commercial-20261020-c4-rc2
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 start deploy/baota/ecosystem.config.js
```

- 前提：§2 R0 已给 `c4-rc2` 补齐 47 条迁移目录，启动门禁才会放行 47 迁移的库（新表留着不用，不删）。
- 成功判据：C7 基础断言同一组在旧版全部通过。
- 数据处置：迁移保留不回退（纯增量、旧代码不引用）。如确需丢弃 47 迁移，走 E4 的恢复流程，不得手工删表。
- 注意：`c4-rc2` 不含 turns 端点，灰度期间已创建的 StoryRun 会话在旧应用下不可用（走旧路径 409 拒绝）——这正是必须**先 E2 关写入、排空在途回合**再切换的原因。

### E4 切换后已有新写入

1. 立即停写（C1 口径）+ E1 停 worker，`npm run state:backup -- m4-rollback-<时刻>` 保存现状；
2. 用 `npm run state:restore` 把 `<BACKUP-FINAL>` 恢复到**全新目录**，不覆盖源库与源备份；
3. 人工核对切换期间的新增数据（订单/支付回调优先；其次故事实例、回合与事件），逐条决定补录；
4. 一起切换数据库、上传与配置（恢复自备份时需轮换 JWT；加密主密钥不换，避免历史商户配置不可读）；
5. PM2 指向恢复后的环境，重跑 C7 基础断言。

### E5 迁移失败（未切 PM2）

- C4 失败时库保持迁移前条数（事务回滚），旧代码照常服务：恢复写入，保持 `c4-rc2` 在线，窗口中止。
- 处置：保留 `prisma migrate deploy` 完整报错与两次备份产物，交 software-architect；修复后重开窗口，从 C3 重新核对。

### E6 通用约束

- 回滚后 48 小时内保留 `<RELEASE>` 目录、两次备份与全部日志，不得清理；
- 每次降级/回滚写操作记录：时刻、触发断言、执行人、worker 启停状态、数据处置决定；
- 恢复后重新进入灰度观察期前，须完成一次 E1/E3 预验证（B4 已覆盖的双态检查）。

## 7. 窗口后观察期（衔接灰度文档）

- 每日记录：5xx 计数、worker 租约等待与 PENDING/FAILED 计数、SQLite 锁等待、AI 费用（对齐第 22/23 章单位体验成本）、SceneFunnel 四比率（管理端报表）；
- 扩量/暂停决策门槛：`docs/planning/releases/story-rollout-flags.md` §4（对齐第 22 章实验指标与 roadmap R4"回退演练和告警门通过再扩量"）；
- 上线交接物（第 27 章）：应用版本、迁移清单、worker 启停、开关位置、预算阈值、告警规则、负责人及回退演练记录——即本 runbook 操作记录 + HANDOFF 第 12 节。

## 8. 附：本 runbook 引用的脚本与文档

| 资源 | 说明 |
|---|---|
| `scripts/pack-release.mjs` | 本地打包（排除 env/db/依赖/构建缓存/上传/产物），自检迁移数与排除物 |
| `scripts/rehearse-migration.mjs` | 副本迁移演练（生产副本模式 / 本地自证模式），断言 integrity、外键、记录数、新表 |
| `scripts/backup-state.mjs`（`npm run state:backup`） | 写库前完整备份：库快照 + 上传 + 清单校验 |
| `scripts/check-release.mjs`（`npm run release:check`） | 发布与库迁移历史兼容性检查 |
| `scripts/start-production.mjs --check-only` | 启动门禁预检（不启动进程） |
| `src/instrumentation.ts` | state worker 启动接线；`STORY_WORKER_DISABLED=1` 跳过（已实现） |
| `scripts/verify-story-eval.mjs` | W08 评测执行器（60 例口径见 M4 终验记录） |
| `deploy/baota/README.md` | 服务器目录、PM2、Nginx、回退的既有约定 |
| `docs/planning/releases/m3-launch-runbook.md` | M3 发布 runbook（本文件流程骨架来源） |
| `docs/planning/releases/story-rollout-flags.md` | 灰度开关设计与扩量/暂停门槛 |
| `docs/planning/releases/m3-m4-release-checklist.md` | 一次窗口 vs 两次上线批次对照（情形 1/2 拍板依据） |
| `docs/planning/releases/admin-password-rotation-plan.md` | 生产管理员密码轮换方案（独立于本次发布执行） |
