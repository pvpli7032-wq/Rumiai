# M3 上线部署 Runbook（生产 45→47 迁移，c4-rc2 → 新发布）

> 依据 `docs/planning/HANDOFF.md` 第 7 节 + `deploy/baota/README.md` 既有约定整理。
> 所有命令只在发布窗口内由部署操作者在服务器执行；本 runbook 的编写与脚本验证均未连接生产。

## 0. 适用范围与红线

- 适用：把 `commercial-refactor` 分支的 M3 数据模型 + 漏斗埋点发布到生产（当前 `commercial-20261020-c4-rc2`，库 45 条迁移）。
- 红线：
  - 不覆盖旧发布目录、共享库、`shared/app.env`、`shared/uploads`；
  - 正式库只允许 `npx prisma migrate deploy`，禁止 `db:push` / `db:init` / reset / 任何手工 DDL；
  - 迁移未在副本演练通过前，不进入发布窗口；PM2 切换未完成断言前，不 `pm2 save`；
  - 出现本 runbook 未覆盖的异常时停止并上报，不即兴发挥。

## 1. 背景与当前基线（发布前核对）

| 项 | 值 |
|---|---|
| 当前发布 | `releases/commercial-20261020-c4-rc2`（BUILD_ID `tRBseGKiU88NSsGiOCagr`） |
| PM2 | 单实例 `khui-ai`，www 身份，仅监听 `127.0.0.1:3000`，`PM2_HOME=/www/wwwroot/khui-ai/shared/pm2` |
| 数据库 | `/www/wwwroot/khui-ai/shared/database.db`，45 条迁移 applied |
| 上传 | `/www/wwwroot/khui-ai/shared/uploads` |
| 环境配置 | `/www/wwwroot/khui-ai/shared/app.env`（发布目录内链接） |
| 回滚位 | `c3`、`c2` 目录保留；本次新增回滚位 = `c4-rc2` |
| 待上线迁移 | `20261020120000_story_run_contract`（6 张 story 表）+ `20261020150000_scene_funnel_events`（1 张埋点表），均纯增量 |

**与 HANDOFF 第 7 节的差异（重要）**：
1. 迁移总数是 **47** 不是 46：仓库在 story_run_contract 之后新增了 `20261020150000_scene_funnel_events`（V0 漏斗埋点，纯增量单表）。下文所有 "46" 一律按 47 执行。
2. 回滚位需要打补丁（见 §2 R0）：`c4-rc2` 只带 45 条迁移，库升到 47 后直接切回会被启动门禁以 `unexpected=2` 拒绝。
3. `release:check` 要跑两遍：迁移前一遍确认"只差新迁移"（pending=2, unexpected=0, failed=0），迁移后一遍必须完全兼容。

## 2. 发布窗口前准备（低风险，可提前做）

### R0 给回滚位补迁移文件（只补文件，不执行 SQL）

在服务器上把两条新迁移**目录**复制进 `c4-rc2` 的 `prisma/migrations/`：

```sh
cp -r /www/wwwroot/khui-ai/releases/<新发布目录>/prisma/migrations/20261020120000_story_run_contract \
      /www/wwwroot/khui-ai/releases/commercial-20261020-c4-rc2/prisma/migrations/
cp -r /www/wwwroot/khui-ai/releases/<新发布目录>/prisma/migrations/20261020150000_scene_funnel_events \
      /www/wwwroot/khui-ai/releases/commercial-20261020-c4-rc2/prisma/migrations/
```

- 成功判据：`ls /www/wwwroot/khui-ai/releases/commercial-20261020-c4-rc2/prisma/migrations | wc -l` = 47（不含 `migration_lock.toml` 则为 46 个目录）；**不执行任何 SQL**，`c4-rc2` 的代码不引用新表，行为不变。
- 失败处理：找不到新发布目录说明 §A 未完成，先走 §A。

### R1 变量表

执行前把下列值定死并抄进操作记录：

| 变量 | 建议值 |
|---|---|
| `<RELEASE>` | `commercial-YYYYMMDD-c5`（日期取发布日） |
| `<BACKUP-PRE>` | `m3-pre-<YYYYMMDD>`（演练源备份） |
| `<BACKUP-FINAL>` | `m3-final-<YYYYMMDD>`（停写后正式回滚点） |
| 维护窗口 | 与产品/客服约定；窗口外不执行 §D |

## 3. Phase A：本地构建与打包（零风险，全部在本机）

### A1 验证基线

```sh
npx tsc --noEmit
npm run verify:done
npm run test:production:guards
node --import tsx --test tests/story-run-service.test.mjs
node --import tsx --test tests/database-upgrade.test.mjs
node --import tsx --test tests/scene-funnel-events.test.mjs
```

- 成功判据：全部退出码 0（浏览器矩阵按 HANDOFF §5 的已知坑执行，不作为本 runbook 硬门禁）。
- 失败处理：修复后重跑；**基线不过不放行打包**。
- 注意：本机不跑 `prisma migrate deploy`（schema-engine 二进制在受限环境被拦，OS Error 5，`scripts/helpers/create-isolated-db.mjs` 头注释有记录）；隔离库验证一律走 `create-isolated-db.mjs` 或本 runbook 的 `rehearse-migration.mjs`，均不依赖 Prisma CLI。

### A2 构建

```sh
npm run build
npm run verify:build
```

- 成功判据：`next build` 退出 0（产物在 `.next-build/`）；`verify:build` 在独立空库上完成迁移+生产构建验证。
- 失败处理：按构建报错修复；确认 `prisma/.local` 无残留锁（`npm run test:clean`）。

### A3 打包

```sh
node scripts/pack-release.mjs <RELEASE> --tar
```

- 成功判据：输出 JSON，`checks:"ok"`、`migrations:47`、`tar.bytes` 与 staging 一致；打包目录位于 `artifacts/release-packs/<RELEASE>/`，tar 包同目录。
- 失败处理：
  - "打包目录已存在"：人工确认旧包可删后删除重打，脚本永不覆盖；
  - "构建目录混入打包"/"排除物混入打包"：按报错清理工作区后重跑；
  - tar 失败：去掉 `--tar` 保留目录，用系统工具手工压缩 `artifacts/release-packs/<RELEASE>`。

注意：打包的是**当前工作区**。打包前确认工作区即待发布状态（未完成的并行改动不要混进来），并把 A1 基线跑在打包前一刻。

### A4 本地迁移演练（本地自证，可随时重跑）

```sh
node scripts/rehearse-migration.mjs
```

- 成功判据：JSON 输出 `mode:"local-baseline"`、`migrations:{appliedCount:47,availableCount:47,pendingCount:0}`、`integrity:"ok"`、`foreignKeys:"ok"`、`countsPreserved:true`、`newTables` 含 6 张 story 表。
- 失败处理：演练失败即迁移有问题，**绝对不进窗口**；把 JSON 报错发给 software-architect。

## 4. Phase B：服务器预装与预备份（不停写、不切流）

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

- 成功判据：输出 JSON `integrity:"ok"`、`foreignKeys:"ok"`，`uploads` 计数与清单一致；产物在 `<RELEASE>/prisma/backups/database-<BACKUP-PRE>-.../database.db`（单文件快照）。
- 失败处理：备份失败 = 不具备上线条件，停止并保留现场；`state:backup` 失败信息中已提示保留目录排查。

## 5. Phase C：副本迁移演练 + 3100 预启动（不接生产写库）

### C1 副本演练

```sh
node scripts/rehearse-migration.mjs /www/wwwroot/khui-ai/releases/<RELEASE>/prisma/backups/database-<BACKUP-PRE>-*/database.db
```

- 成功判据：JSON `mode:"production-copy"`、`appliedNow` 恰好列出两条新迁移、`migrations.appliedCount=47`、`integrity/foreignKeys ok`、`countsPreserved:true`、`newTables` 6 张 story 表。
- 失败处理：任何断言失败 → 终止上线；保留 `KEEP_TEST_DB=1` 重跑一次的现场，交 software-architect 定位。演练通过前**绝不**对 `shared/database.db` 执行迁移。

### C2 3100 预启动（接副本库）

```sh
cd /www/wwwroot/khui-ai/releases/<RELEASE>
# 先把演练通过的副本复制为预启动库（保持单文件，无 -wal/-shm）
cp <演练副本> prisma/.local/prestart.db
mkdir -p prisma/.local/uploads && cp -r /www/wwwroot/khui-ai/shared/uploads prisma/.local/uploads-prod-copy

DATABASE_URL=file:/www/wwwroot/khui-ai/releases/<RELEASE>/prisma/.local/prestart.db \
  node scripts/start-production.mjs --check-only

NEXT_DIST_DIR=.next-build UPLOADS_DIRECTORY=/www/wwwroot/khui-ai/releases/<RELEASE>/prisma/.local/uploads-prod-copy \
  DATABASE_URL=file:/www/wwwroot/khui-ai/releases/<RELEASE>/prisma/.local/prestart.db \
  npx next start --hostname 127.0.0.1 --port 3100 &
```

说明：
- `--check-only` 先跑一次启动门禁（`assertReleaseCompatible` 对副本库），打印 `release_migrations_compatible` 后即退出；
- 直接 `npx next start` 不经 npm lifecycle，`next.config` 会退回 `.next`，必须显式 `NEXT_DIST_DIR=.next-build`；
- 预启动只做只读冒烟，写入落在副本库与副本上传目录，不碰 shared。

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
  进程日志无 error 堆栈。
- 失败处理：任一断言不符 → 停止 3100 进程，终止上线，保留日志。冒烟通过后 `kill` 该进程并确认 3100 已释放。

## 6. Phase D：发布窗口（停写 → 迁移 → 切换 → 断言 → 观察）

### D1 停写

停掉全部业务写入：后台"业务只读维护"**不**拦截管理写入与进行中请求，只能作为辅助；须确认无进行中的聊天回合、上传清理与结算任务。

- 成功判据：操作记录写明停写时刻与确认人。
- 失败处理：无法确认写入静默 → 推迟窗口。

### D2 终备份（正式回滚点）

```sh
npm run state:backup -- <BACKUP-FINAL>
```

- 成功判据：同 B2；此备份是迁移的正式回滚点。
- 失败处理：备份失败 → 放弃本次窗口，恢复写入，另行排期。

### D3 迁移前 release:check（确认只差新迁移）

```sh
npm run release:check -- /www/wwwroot/khui-ai/shared/database.db
```

- 成功判据：**预期失败**，但 JSON 必须是 `pending=2, unexpected=0, failed=0`。出现 `unexpected>0` 或 `failed>0` → 停止，库状态与预期不符。
- 失败处理：按 JSON 报告核对 `_prisma_migrations`；不得强行迁移。

### D4 正式迁移

```sh
npx prisma migrate deploy
```

- 成功判据：输出显示应用 2 条迁移；`_prisma_migrations` 完成数 = 47。SQLite 下单条迁移整体事务化，失败自动回滚。
- 失败处理：迁移报错 → **不启动新代码**，PM2 旧版继续跑（45 迁移与旧代码兼容）；保留报错现场，按 §7 R1 处置。

### D5 迁移后 release:check（必须完全兼容）

```sh
npm run release:check -- /www/wwwroot/khui-ai/shared/database.db
```

- 成功判据：退出码 0，JSON `compatible:true, pendingCount:0, unexpectedCount:0, failedCount:0`。
- 失败处理：不切换 PM2；按 §7 R1。

### D6 PM2 切换

```sh
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 describe khui-ai | grep cwd
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 delete khui-ai
cd /www/wwwroot/khui-ai/releases/<RELEASE>
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 start deploy/baota/ecosystem.config.js
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 describe khui-ai | grep cwd   # 必须指向 <RELEASE>
```

- 成功判据：`pm_cwd` 指向 `<RELEASE>`；状态 online；启动日志出现 `release_migrations_compatible` 与 `sqlite_wal_ready`（启动门禁通过）。
- 失败处理：启动门禁失败或 online 起不来 → 按 §7 R2 立即回滚。

### D7 断言（公网）

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

- 成功判据：以上全部符合；管理员登录成功一次；发一条聊天消息走通（AI provider 走后台配置，503 边界行为按 deploy README 口径判断）。
- 失败处理：任一断言不符 → §7 R2。

### D8 60 秒观察 + 保存进程表

```sh
sleep 60
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 list
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 logs khui-ai --lines 50 --nostream
```

- 成功判据：60 秒内 `restarts` 计数不变、内存稳定、日志无 error 刷屏。
- 失败处理：反复重启 → §7 R2。全部通过后 `pm2 save`（**此前绝不 save**），恢复写入，发布窗口关闭。

## 7. 回滚预案

### R1 迁移失败（未切 PM2）

- D4 失败时库仍为 45 迁移（事务回滚），旧代码照常服务：恢复写入，保持 `c4-rc2` 在线，窗口中止。
- 处置：保留 `prisma migrate deploy` 完整报错与 `npm run state:backup` 产物，交 software-architect；修复后重开窗口，从 §6 D3 重新核对。

### R2 切换后失败、无新增写入

```sh
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 delete khui-ai
cd /www/wwwroot/khui-ai/releases/commercial-20261020-c4-rc2
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 start deploy/baota/ecosystem.config.js
```

- 前提：§2 R0 已给 `c4-rc2` 补齐 47 条迁移目录，启动门禁才会放行 47 迁移的库（新表留着不用，不删）。
- 成功判据：D7 同一组断言在旧版全部通过。
- 数据处置：迁移保留不回退（纯增量、旧代码不引用）。如确需丢弃 47 迁移，走 R3 的恢复流程，不得手工删表。

### R3 切换后已有新写入

1. 立即停写，`npm run state:backup -- m3-rollback-<时刻>` 保存现状；
2. 用 `npm run state:restore` 把 `<BACKUP-FINAL>` 恢复到**全新目录**，不覆盖源库与源备份；
3. 人工核对切换期间的新增数据（订单/支付回调优先），逐条决定补录；
4. 一起切换数据库、上传与配置（恢复自备份时需轮换 JWT；加密主密钥不换，避免历史商户配置不可读）；
5. PM2 指向恢复后的环境，重跑 D7 断言。

### R4 通用约束

- 回滚后 48 小时内保留 `<RELEASE>` 目录、两次备份与全部日志，不得清理；
- 每次回滚写操作记录：时刻、触发断言、执行人、数据处置决定。

## 8. 附：本 runbook 引用的脚本与文档

| 资源 | 说明 |
|---|---|
| `scripts/pack-release.mjs` | 本地打包（排除 env/db/依赖/构建缓存/上传/产物），自检迁移数与排除物 |
| `scripts/rehearse-migration.mjs` | 副本迁移演练（生产副本模式 / 本地自证模式），断言 integrity、外键、记录数、新表 |
| `scripts/backup-state.mjs`（`npm run state:backup`） | 写库前完整备份：库快照 + 上传 + 清单校验 |
| `scripts/check-release.mjs`（`npm run release:check`） | 发布与库迁移历史兼容性检查 |
| `scripts/start-production.mjs --check-only` | 启动门禁预检（不启动进程） |
| `deploy/baota/README.md` | 服务器目录、PM2、Nginx、回退的既有约定 |
| `docs/planning/releases/admin-password-rotation-plan.md` | 生产管理员密码轮换方案（独立于本次发布执行） |
