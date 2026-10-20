# 交接说明（2026-10-20 03:10）

> 目的：让接手的人不必回溯对话就能继续。所有数字与路径均为本机核对结果，不是叙述推测。

## 1. 一句话现状

V0 已上线生产并验收通过；M0 抽取、M3（数据模型 + 回合编排）与 M4（记忆与章节闭环）已全部合入本地分支（`0e72f85..ed0cd03`，含 W08 评测框架与执行器），**均未部署**。本地库 47 条迁移（生产仍 45 条，`20261020120000_story_run_contract` 与 `20261020150000_scene_funnel_events` 两条待发布）。M5 试点交付文档（runbook + 灰度设计 + 批次对照）已就绪：`docs/planning/releases/m5-pilot-runbook.md`、`story-rollout-flags.md`、`m3-m4-release-checklist.md`。下一步是用户对上线批次拍板 → 发布窗口 → M5 灰度观察。

## 2. 代码位置与状态

- 工作目录：`C:\Users\42422\Desktop\ai-role-community`
- 分支：`commercial-refactor`；本轮有未提交的 M3 API、兼容保护与测试改动
- 本轮起点 HEAD：`a3e884e docs(planning): 补交接说明`

最近 6 个提交：

| commit | 内容 |
|---|---|
| `2e915f7` | M3：6 个故事模型 + 纯增量迁移 `20261020120000_story_run_contract` |
| `b05b65b` | M0：抽取 `chat-application-service`，两个消息路由只留 HTTP 层 |
| `391763f` | 文档：记录 V0 上线生产与内容审核闭环 |
| `ac6840a` | V0：按内容审核收紧场景文案与结束页口径 |
| `784cfad` | V0：场景卡、三条建议动作、本地章节回顾 |
| `95b5521` | 部署：兜住生产启动的构建目录，清理 tsconfig 死条目 |

## 3. 生产环境现状（已核实）

| 项 | 值 |
|---|---|
| 域名 | `https://lh.y-98.cn`，`/` 307 → `/zh` |
| 当前发布 | `commercial-20261020-c4-rc2`（BUILD_ID `tRBseGKiU88NSsGiOCagr`） |
| 部署路径 | `/www/wwwroot/khui-ai/releases/commercial-20261020-c4-rc2` |
| PM2 | 单实例 `khui-ai`，online，重启 0；3000 端口仅此一个 next-server |
| 数据库 | `/www/wwwroot/khui-ai/shared/database.db`，45 条迁移全部 applied |
| 备份 | `shared/backups/database-release-c4rc2-20261020`、`database-release-c3-20261020` |
| 回滚位 | `c3` 与 `c2` 目录均保留 |
| SSH | `ssh -i ~/.ssh/khui_deploy_ed25519 root@43.242.194.115` |

认证（2026-10-20 02:0x + 03:0x 两次核对）：`/zh`、`/discover`、`/shop`、`/api/site`、`/admin`、`/login` 全 200；匿名 `/api/admin/access` 401；旧前缀 `/api/v1/site` 404。

**注意：生产库还没有新迁移。** 6 张 story 表只存在于本地库。上线 M3 前必须按第 7 节流程走。

## 4. 三个模块各自的位置

### 4.1 V0 场景体验（已上线）
- 领域：`src/lib/stories/scene-config.ts`（三条场景静态配置）、`scene-service.ts`（`resolveScene` 四种不可用原因）、`chapter-close.ts`（真实片段提取）
- 组件：`src/components/stories/`（story-card、scene-header、scene-entry-state、chapter-close、end-chapter-dialog）、`src/components/chat/action-suggestions.tsx`
- 接线：`src/app/(app)/discover/page.tsx`、`src/components/character-detail-dialog.tsx`、`src/app/[locale]/character/[id]/page.tsx`、`src/app/(app)/chat/page.tsx`
- 测试：`tests/stories-v0.test.mjs`（5 条）、`scripts/verify-v0-story-browser.mjs`（11 条）

### 4.2 聊天应用服务（已合入，未部署）
- `src/lib/conversations/chat-application-service.ts` — `executeChatTurn()`，一次聊天回合的完整编排
- 两个路由只剩 HTTP 层：`src/app/api/conversations/[id]/messages/route.ts`（POST + 原 GET）、`.../[messageId]/regenerate/route.ts`
- 行为对照表：`docs/planning/m0-behavior-parity.md`（**改这里之前必读**）
- 测试：`tests/chat-application-service.test.mjs`（7 条）、`tests/m0-route-behavior.test.cjs`（14 条）、`tests/m2-context.test.cjs`（4 条）

### 4.3 M3 数据模型（已合入，未部署）
- `prisma/schema.prisma` 末尾 6 个模型；`prisma/migrations/20261020120000_story_run_contract/migration.sql`
- 契约：`docs/planning/m3-data-contract.md`（第 1 节模型、第 5 节 API、第 9 节拍板结论）
- 迁移已验证纯增量：`conversations`/`messages`/`users` 三表建表语句与索引前后逐字节相同，`foreign_key_check` 0 行

## 5. 验证基线（改动后用这些自证）

```
npx tsc --noEmit                                      # 类型
node scripts/check-definition-of-done.mjs             # 完成定义（8 项）
node scripts/run-production-guards.mjs                # 生产门禁 2 条
node --import tsx --test tests/chat-application-service.test.mjs tests/conversation-message.test.mjs tests/conversation-service.test.mjs
node tests/m0-route-behavior.test.cjs                 # 14 条
node --test tests/m2-context.test.cjs                 # 4 条
node --import tsx --test tests/stories-v0.test.mjs    # 5 条
node --import tsx --test tests/database-upgrade.test.mjs
DISABLE_MOCK_AI=false node scripts/run-browser-matrix.mjs test:browser   # 9 PASS / 1 SKIP
```

浏览器矩阵的几个坑（**踩过，不要再踩**）：
- 必须显式 `DISABLE_MOCK_AI=false`，否则本地 `.env` 里是 true，聊天返回 503。
- `test:m2:chat` 硬要求 18782 端口，矩阵用随机端口，跑不通是既有问题。
- `test:screenshots` 会因 `NEXT_PUBLIC_SITE_URL` 是 localhost 而 307 失败，既有问题。
- `npm test`（`tests/runner.ts`）要求 `localhost:3000` 有服务，否则 147 条全 fetch failed，不是回归。
- 发现页场景区是客户端渲染，**curl/grep HTML 永远找不到**，必须用浏览器。

## 6. 当前阻塞与已知问题

1. **生产管理员密码仍是 `123123`**，未轮换。这是线上安全缺口，优先级高于功能开发。
2. **V0 四个漏斗指标没有埋点**：开场到达率、首条消息发出率、主动结束率、结束页继续点击率。V0 上线验证的是"能跑通"，不是"漏斗有改善"，无法用数据判断 V0 是否成功。
3. **发布候选复审有一处偏差**：映雪那条公开问题改完后未再走完整复审即上线，已记在 `docs/planning/v0-acceptance-record.md`。
4. **生产环境没有 AI 密钥**：`app.env` 里 `OPENAI_API_KEY` 为空，但数据库里有 provider 记录（`ces`）和模型 `gpt-6.1-sol`，走的是后台配置的 provider。真实模型调用能否成功未验证过。

## 7. 上线 M3 的流程（必须先做）

不要直接切 c4-rc2 加新表。顺序：

1. 本地 `npm run build` + `npm run db:local` 通过
2. 打包发布目录（排除 env/db/node_modules/.next/uploads/artifacts/temp）
3. 服务器上 `npm run state:backup`（写库前备份，验证 integrity + foreignKeys）
4. **在副本上先跑迁移**：复制生产库 → 对新副本执行 `20261020120000_story_run_contract/migration.sql` → 核对记录数、`foreign_key_check`、`_prisma_migrations` = 46
5. 3100 预启动（`next start --hostname 127.0.0.1 --port 3100`），不接线上写库
6. 停写 → `release:check` → PM2 切新目录 → `pm2 save` → 断言 → 60 秒观察
7. 失败回滚：PM2 切回 c4-rc2（新表留着不用，不删）

## 8. 下一步（按序）

| 阶段 | 内容 | 写作用域 |
|---|---|---|
| M5 拍板 | 上线批次决策（一次窗口 vs 两次窗口）：`docs/planning/releases/m3-m4-release-checklist.md` | 决策记录写入该文档 §4 |
| M5 发布 | 按 `docs/planning/releases/m5-pilot-runbook.md` 执行（Phase A 本地 → B 预装 → C 窗口 → 观察期）；前置：灰度旗标 F1–F3 实现（`story-rollout-flags.md`，另立任务）、管理员密码轮换 | `src/lib/stories/**`（旗标）、生产操作 |
| M5 观察期 | 灰度观察指标与扩量/暂停决策：`story-rollout-flags.md` §3/§4 | 运维记录、`docs/planning/releases/**` |

M4 剩余尾巴：`deleteMessageAndFollowing` 同毫秒相邻消息一并删除的精度问题（M4 终验 §5.6，低优先级，建议后续按 turnNo/message ID 收紧删除范围）；M4 退出条件中的备份恢复演练归入 M5 发布流程（runbook Phase B3）。

## 9. 团队与文档

- 团队：lead、product-lead、software-architect、engineering-lead、ux-designer、qa-lead、devops-lead、security-lead、delivery-manager
- 规划书：`docs/planning/角色关系连续剧产品与实施规划书_完整详细版_V1.0.docx`
- 工作流文档：`docs/planning/roadmap.md`（W01–W09、M0–M5、R0–R4 发布批次）
- 纯文本版规划书：`.temp/plan-final.txt`（便于 grep，未纳入版本控制）

## 10. 工程约定（这个仓库特有的）

- 文案层不能有 `zhText`；不要写泰国字符（现有词典除外）；前台不能引用后台组件。
- 组件只用 `@/components/ui` 原语，不引新依赖。
- 不用 `localStorage` 伪装跨设备进度，不把 AI 编造的总结当数据库事实。
- 迁移只许增量，不许 `ALTER` 既有表（除非有明确批准与回滚方案）。
- 删代码要删干净：被替换的实现、死导出、临时脚本一并清掉，不留沉淀。

## 11. 2026-10-20 M3-2 接续记录

本轮完成的是故事实例创建/读取，不代表整个 M3 完成：

- 新增 `POST /api/story-runs`、`GET /api/story-runs`、`GET /api/story-runs/[id]`；仓储和 DTO 在 `src/lib/stories/repository/`，HTTP 层只负责登录、参数解码、状态码。
- 创建实例、专属 Conversation、revision=0 初始 checkpoint、角色聊天计数在同一事务；用户/requestId 唯一幂等，相同请求返回 200，不同版本或初始章节返回 409；新建返回 201。初始 checkpoint 保留原始章节，当前章节变化不影响创建重试。
- 所有权同时检查 Run/Conversation；模板必须 PUBLISHED 且 publishedAt 已到达，角色必须本人拥有或公开审核通过。列表只返回可访问实例，按 updatedAt/id 游标分页。
- 详情使用公开字段白名单；隐藏剧情、角色提示词、stateJson、lease、请求键不输出；事件仅暴露已确认、未失效、来源回合已处理且来源消息属于本会话的数据。
- 新建故事会话后，旧 SEND/REGENERATE 不能绕过状态机。提前落地 M3-3 的拒绝分支（409），回合编排仍待实现；旧编辑/删除单条消息也暂拒绝，避免未来派生状态失效被绕过。整段会话删除保留级联语义。普通创建/复用会话排除 StoryRun，避免复用到不能自由发送的故事。
- 不创建正式模板，不开放前台入口；未改 schema/迁移、生产环境、管理员凭据。

验证入口：`node --import tsx --test tests/story-run-service.test.mjs`（8 条，真实隔离 SQLite + 46 条迁移，含 HTTP 适配器、并发创建、隐私、级联）。聊天应用/消息/会话回归 13 条、M0 路由 14 条、M2 上下文 4 条、V0 5 条均通过；类型检查、完成定义 8 项通过。生产构建/门禁结果见后续验证记录。

下一步：M3 回合服务（turns SSE、requestHash/revision CAS、activeTurnId、消息原子提交、未知结果恢复），替换当前故事发送拒绝分支；接着 M4 retry-state/close-chapter/resume、worker 与历史失效事务。未实现端点不能记为已完成。生产发布仍须先过第 7 节流程。

## 12. 2026-10-20 M4 完成记录（记忆与章节闭环）

M4 已合入（`0e72f85` 闭环主体 + `e89bdc2` W08 执行器 + `ed0cd03` worker 接线），终验通过（`.workbuddy/memory/baseline-2026-10-20.md` 第五节：全量基线绿、W08 实跑 15/0/44/1、边界攻击 11 项全过、浏览器矩阵 9 PASS/1 SKIP）。关键决策：

- **依赖倒置**：`message-service` 不直接 import story 模块，改为 `registerStoryHistoryInvalidator` 注册回调——旧聊天模块与故事失效事务解耦，普通会话编辑/删除语义零变化（m0-route 14 条 + chat 13 条 + lifecycle "normal conversations keep their edit and delete semantics untouched" 锁定）。
- **额度预留**：state worker 的整理调用走 `story-state-quota` 预留，模型调用成功但整理失败不重复扣同一条聊天费用（第 23 章计费原则）；预算不足延后整理、保留已保存内容，不以编造回复兜底。
- **运维开关**：`STORY_WORKER_DISABLED=1`（`src/instrumentation.ts` 启动前检查，提交 `ed0cd03`）——worker 暂停/恢复演练与生产降级路径（m5-pilot-runbook §6 E1）的既有基础。
- **持久租约与失效**：worker 条件认领（updateMany where stateStatus=PENDING）、租约保护提交、失效胜过 live lease、坏 stateJson 拒绝置 FAILED/STATE_DATA_CORRUPT 不静默覆盖——边界攻击 A1–A5 全部守住。
- 失效事务（C3–C5）已随编辑/删除接线启用并验证：消息变更与 StoryEvent/Checkpoint/stateJson 失效同事务、turnNo 因果、重建回退游标。

M5 试点交付文档（W09，release-prep）：`docs/planning/releases/` 下 `m5-pilot-runbook.md`（R4 发布 runbook，含 Phase E 降级/回滚）、`story-rollout-flags.md`（灰度开关设计，**未实现**，F1–F3 待批准另立任务）、`m3-m4-release-checklist.md`（上线批次对照，待拍板）。生产发布前生产库仍 45 条迁移，发布须走 m5-pilot-runbook（合并了 m3-launch-runbook 流程骨架）。
