# 结构审查与死代码清查报告（2026-10-20）

执行人：cleanup-auditor（任务 #7）
分支：`commercial-refactor`，基线 HEAD `9d1ebd5`
验证：`npx tsc --noEmit` 0 错误；`node scripts/check-definition-of-done.mjs` 8 项全过。
所有删除均为未纳入版本控制的产物文件（git status 除 `.workbuddy/memory` 系统改动外保持干净）。

## 1. 已删除（含证据）

### 1.1 验证构建目录（约 823MB）

任务描述为 4 个约 1.2GB，实际磁盘核对只有 3 个、合计 823MB；仓库根目录不存在 `.next`（本地从未跑过 `npm run build` 直出）。

| 目录 | 大小 | 证据 |
|---|---|---|
| `.next-build/` | 364M | `scripts/verify-production-build.mjs` 的隔离构建产物（BUILD 目录） |
| `.next-validation-build/` | 324M | 同上，历史验证轮次残留 |
| `.next-story-m3-validation/` | 135M | 同上，M3 验证轮次残留 |

### 1.2 artifacts/ 纯测试产物（24 项）

抽样确认：`*-browser` 目录为 `scripts/verify-*-browser.mjs` 系列的截图/log/JSON 断言产物（脚本内 `out=path.resolve('artifacts/<name>', stamp)`）；`browser-matrix` 为 `run-browser-matrix.mjs` 产物（目录名即 pid-timestamp）；`circle-migration-*` 为圈层迁移测试随机后缀产物；`typecheck.tsbuildinfo` 为 tsc 增量缓存。已删除：

```
account-management-browser  admin-browser  admin-management-browser
ai-cost-browser  ai-model-browser  ai-provider-browser  analytics-browser
browser-matrix  character-management-browser  circle-management-browser
circle-migration-3HaeB5  circle-migration-HWAnG6  circle-migration-I81Kmy
circle-migration-IK5O8n  circle-migration-XqaPRB  compliance-browser
growth-browser  operations-browser  payment-merchant-browser
payment-orders-browser  post-management-browser  security-browser
site-content-browser  typecheck.tsbuildinfo
```

### 1.3 prisma/ 废弃测试库（30 个文件）

活库判定：`.env:2` 指向 `prisma/.local/dev.db`（存在，未动）；`npm run db:local` 走 `scripts/make-local-db.mjs`。以下全部是验证脚本的运行时产物（脚本内 `file:` url + `process.pid-Date.now()` 命名），删除后需要时由脚本重建：

- `m2-chat.db`（`verify-m2-chat.mjs` 隔离库）
- `m3-circles.db` / `m3-content.db` / `m3-follow.db` / `m3-moderation.db` / `m3-posts.db`（对应 `verify-m3-*.mjs`）
- `isolated-build-*-*.db(+shm/wal)`（`verify-production-build.mjs` 随机库）
- `operations-browser-*-*.db(+shm/wal)`（`verify-operations-browser.mjs`）
- `scene-funnel-*` 6 个（`tests/scene-funnel-*.test.mjs` 的 `scene-funnel-${pid}-${Date.now()}.db`）

### 1.4 scripts/ 死脚本：未发现

全量核对 66 个脚本：`package.json` 未引用的仅 6 个，但均有其他引用，全部保留：

| 脚本 | 引用处 |
|---|---|
| `check-site-health.mjs` | `tests/site-health.test.mjs` |
| `pack-release.mjs` | `docs/planning/releases/m3-launch-runbook.md` |
| `rehearse-migration.mjs` | 同上 |
| `verify-production-guards.mjs` | `scripts/run-production-guards.mjs` |
| `verify-story-eval.mjs` | `docs/planning/w08-eval-plan.md`、`tests/story-evaluation/traceability-matrix.md` |
| `verify-v0-story-browser.mjs` | `docs/planning/HANDOFF.md`、`docs/planning/v0-acceptance-record.md` |

## 2. 保留并标注（验收/发布证据类）

- `artifacts/acceptance-20261018/`、`artifacts/acceptance-current/`：V0 验收记录与评估结论（`assessment-final.md` 等），属验收证据。
- `artifacts/planning/20261019-story/`：规划文档渲染管线（source-baseline、delivery-verification）。
- `artifacts/release-packs/`（空目录，runbook 第 92 行的打包输出位）、`artifacts/releases/`（发布包 + sha256）。
- `prisma/story-eval-*-*.db(+wal/shm)`：评测执行器（eval-executor）当前运行中的测试库，属动态产物，未动。
- `tailwind-legacy-colors.json`：**在用**——`tailwind.config.ts:2` `import legacyColors from './tailwind-legacy-colors.json'`，不删。

## 3. 待决项（发现但未处置，需拍板）

### 3.1 api-paths.ts 约定未执行（结构性问题）

`src/lib/api-paths.ts` 共 119 个路径条目，实际被引用的只有 5 条（`API.characters.list`、`API.analytics.funnelEvents`、`API.admin.session`、`API.admin.analyticsFunnel`、`API.coins.ledger`，消费方仅 6 个文件）。同时组件层大量硬编码 `/api/...` 字面量（如 `src/app/(app)/chat/page.tsx:124`、`src/components/chat-inbox.tsx:11`），与文件头"组件里不再写 `/api/...` 字面量"的约定相悖。

处置建议二选一：(a) 把组件层 fetch 全量迁到 API 常量（约 100+ 处，超出本次清理范围）；(b) 承认该文件只是文档化清单并修订头注释。**本次未删除任何条目**——删除 114 条孤儿等于宣判约定作废，需明确拍板。

### 3.2 i18n 词典 923 键仅 2 键被消费（设计如此，未动）

10 个 `src/lib/i18n/dictionaries/*.json`（共约 9.6k 行）是 `pull-i18n-dictionaries.mjs` 从线上站拉取的参考数据，`src/lib/i18n.ts:330` 注释明示"覆盖面远大于本应用当前渲染的字段"；实际只经 `PULLED_FIELDS` 消费 `login`、`startChatButton` 两键。属刻意保留的参考语料（也是 DoD"泰语字符仅存在于 i18n 词典"放行的原因），不建议删减键；如要瘦身需先改 pull 脚本策略。

### 3.3 stories ↔ conversations 域间双向依赖（红线区，只报告）

三域跨域边全量清单（grep `@/lib/(stories|conversations|analytics)` 取证）：

- `src/lib/stories/turn-service.ts:23-24` → `conversations/chat-stream`、`conversations/message-service`
- `src/lib/stories/lifecycle/state-worker.ts:26` → `conversations/chat-stream`
- `src/lib/conversations/message-service.ts:3` → `stories/lifecycle/invalidation`
- `src/lib/analytics/*`：无跨域依赖（干净）

stories 与 conversations 构成域级双向依赖。观察：`chat-stream.ts` 实质是共享流式工具层，放 conversations 域导致 stories 反向引用；`message-service → stories/lifecycle/invalidation` 是 M3-3 分流的结果。建议：把 `chat-stream` 下沉到中立位置（如 `src/lib/ai/` 或 `src/lib/http/`）；`invalidation` 反向边是否可接受，建议在 M4 生命周期设计时一并裁决。**红线区内未做任何改动。**

## 4. 结构审查结论（无违规项）

- **死导出：0**。全 src 扫描（含 `export {}` 列表语法，语料覆盖 src/tests/scripts，防 tsx 直连漏判），无任何 export 失去全部引用。
- **未引用整文件：0**。src 下全部非路由文件均有 import 引用（路由约定文件 page/layout/route 等按框架惯例豁免）。
- **旧实现残留：0**。三域无 TODO/FIXME/legacy/注释掉的代码；M3-3 重构确认干净——两个消息路由只剩 HTTP 层（messages route 37 行、regenerate 21 行，全部委托 `executeChatTurn`）；埋点 4af8a64、报表 be80b61 均为纯新增提交，无可回溯的被替换代码。
- **前后台隔离**：DoD 第 7 项"前台 0 处引用后台组件"通过。
- **M4 红线区现状**（仅记录）：`src/lib/stories/`（lifecycle 4 文件、repository 2 文件、turn-service 等）与 `src/app/api/story-runs/` 完整在位，未改动。

## 5. 本次改动清单汇总

| 类别 | 数量 | 释放空间 |
|---|---|---|
| .next-* 构建目录 | 3 个 | ~823MB |
| artifacts 测试产物 | 24 项 | ~30MB 中绝大部分 |
| prisma 废弃测试库 | 30 个文件 | ~25MB |
| 源码删除 | 0（无可删项） | — |
