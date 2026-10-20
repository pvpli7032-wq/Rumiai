# 交接说明（2026-10-21 c5 已上线生产）

> 目的：让接手的人（人或 AI）不必回溯对话就能继续。所有数字与路径均为本机核对结果，不是叙述推测。
> 交接对象注意：本文件是唯一权威入口。规划书全文在 `docs/planning/角色关系连续剧产品与实施规划书_完整详细版_V1.0.docx`，可 grep 纯文本版 `.temp/plan-final.txt`；回归基线与终验记录在 `.workbuddy/memory/baseline-2026-10-20.md`。

## 1. 一句话现状

V0 已上线生产并验收通过；**M0–M5 开发线（W01–W09 工程侧）全部完成并已提交**：M0 抽取、M3 数据模型+回合编排、M4 记忆与章节闭环、W08 评测框架+执行器、W07 生命周期（导出/分享/下架/级联）、灰度旗标 F1–F4，全部终验通过（记录见 `.workbuddy/memory/baseline-2026-10-20.md` 第四/五/六节）。生产当前已切到 `commercial-20261021-c5`；BUILD_ID 以服务器 `.next-build/BUILD_ID` 为准；生产 48 条迁移，PM2 online/restarts 0、exec cwd 指向 c5，`pm2 save` 已完成，60 秒 soak 12/12 返回 200。回滚位 `c2`/`c3`/`c4-rc2` 保留。发布文档全部就绪并已同步计数：`docs/planning/releases/m5-pilot-runbook.md`（主流程）、`story-rollout-flags.md`、`m3-m4-release-checklist.md`。**当前剩余是用户决策与灰度观察**：管理员密码轮换、试点名单与告警责任人。

## 2. 代码位置与状态

- 工作目录：`C:\Users\42422\Desktop\ai-role-community`
- 分支：`commercial-refactor`；工作区干净，全部成果已按模块分 15+ 提交落库
- 本轮起点 HEAD：`9cb5029 docs：发布文档迁移计数同步至 48`

本轮（2026-10-20 09:38 起三个团队轮次）关键提交：

| commit | 内容 |
|---|---|
| `8fed504` | M3：回合编排服务（turns SSE、CAS、幂等、原子提交） |
| `4af8a64` / `be80b61` | V0 漏斗埋点 + 管理端报表 |
| `693347a` / `e89bdc2` | W08 评测框架 + 执行器（22 例可执行，语义断言进人工复核队列） |
| `26ee4a4` | 首发 3 主角 × 2 章内容初稿（含 15 条评测种子 EV-01~15） |
| `64d40b3` / `055031b` | 发布 runbook（M3 + M5 试点）+ 灰度设计 + 批次对照 |
| `0e72f85` | M4：状态 worker、结章/恢复、同事务失效、依赖倒置、worker 额度预留 |
| `ed0cd03` | M4：worker 进程接线（STORY_WORKER_DISABLED 运维开关） |
| `73b1cf8` | W07/M5：导出白名单、story_shares 分享撤回、下架读写分离、turn 提交数据完整性修复 |
| `b5f12db` | 发布前置：灰度旗标 F1–F3 薄层落地 + database-upgrade 测试适配 |
| `9cb5029` | docs：迁移计数同步 48 + W07 终验记录 |

## 3. 生产环境现状（已核实）

| 项 | 值 |
|---|---|
| 域名 | `https://lh.y-98.cn`，`/` 307 → `/zh` |
| 当前发布 | `commercial-20261021-c5`（BUILD_ID 以服务器 `.next-build/BUILD_ID` 为准） |
| 部署路径 | `/www/wwwroot/khui-ai/releases/commercial-20261021-c5` |
| PM2 | 单实例 `khui-ai`，online，重启 0；3000 端口仅此一个 next-server |
| 数据库 | `/www/wwwroot/khui-ai/shared/database.db`，48 条迁移全部 applied |
| 备份 | `shared/backups/database-release-c4rc2-20261020`、`database-release-c3-20261020` |
| 回滚位 | `c2`、`c3`、`c4-rc2` 目录均保留 |
| SSH | `ssh -i ~/.ssh/khui_deploy_ed25519 root@43.242.194.115` |

认证（2026-10-20 02:0x + 03:0x 两次核对）：`/zh`、`/discover`、`/shop`、`/api/site`、`/admin`、`/login` 全 200；匿名 `/api/admin/access` 401；旧前缀 `/api/v1/site` 404。

**注意：生产库已含全部 48 条迁移**（c5 切流时应用了 `20261020120000_story_run_contract`、`20261020150000_scene_funnel_events`、`20261020160000_story_shares`）。8 张 story 表与 `scene_funnel_events` 均已在生产库中，实测计数见 `docs/planning/releases/cutover-record-20261021.md`。

生产端到端实测（2026-10-21 04:1x）：注册 → `POST /api/story-runs` 201 建实例 → 同 requestId 幂等重放返回同一实例 → 不存在章节 422 → 详情 200 → 匿名详情/回合/导出/分享/列表全 401；全程 `pageerror` 0。测试账号事后经 `POST /api/users/me/close` 走产品自身的注销路径清理，`story_runs` 归 0、`conversations` 回到 3、`messages` 回到 6。

### 3.2 M4 记忆闭环（已提交，未上线）

worker 把每回合抽出的确认事实写进 `run.stateJson`，但 `turn-service` 生成时只用近期消息 + 当前输入 —— 规划书第 19 章要求的「模板版本 + 已确认事实 + 近期消息 + 当前输入」此前只做了后半段。现已补上：

- `src/lib/stories/lifecycle/context-service.ts` 的 `buildStoryContext(run)`：白名单组装故事标题、当前章节标题、公开简介、最近 40 条已确认事实与三条固定规则（事实不得改写、不得声称用户答应过未答应的事、用户行动不得代劳）。
- `chat-stream.ts` 的 `stream[OI]Response` 接受可选 `context`，仅在提供时以空行追加；**不传时系统提示逐字不变**，自由聊天零影响。
- `turn-service.ts` 只计算一次，真实与 mock 路径共用。
- 泄漏红线：hiddenFacts、原始 stateJson、完整 prompt、leaseOwner、requestHash 都不进入；模板损坏只降级成 chapterKey。
- 测试：`tests/story-context.test.mjs`（5 条）。

上线后可用 `story_state_worker_started` 日志确认 worker 在跑（`51b4747`）。

### 3.1 故事模板（已发布 1 个）

`story_templates` / `story_template_versions` 原本没有任何写入路径，等于 `POST /api/story-runs` 恒定 404。现已补上唯一入口：

- 工具：`scripts/publish-story-template.mjs`（`npm run story:publish`，支持 `--dry-run` / `--unpublish`）
- 内容：`content/stories/*.json`；试点为 `xingban-original-0-ch1.json`（林澈，3 章）
- 校验：复用 `src/lib/stories/repository/contracts.ts` 的 `readVersion`，不另写一套
- 幂等：规范化 JSON 哈希相同即跳过，内容变更才 `version+1`
- 生产现状：`story_templates` 1 行 PUBLISHED，`story_template_versions` 1 行 v1
- 测试：`tests/story-template-publish.test.mjs`（4 条）

发布新内容或新角色：改 `content/stories/` 后跑 `npm run story:publish`，再按第 7 节流程随下一次发布上线工具本身。

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

### 4.4 故事回合编排与生命周期（M3-3/M4/W07，已合入未部署）
- 回合：`src/lib/stories/turn-service.ts`（SSE 编排、CAS、幂等）、`src/lib/stories/lifecycle/`（state-model/state-worker/chapter-service/invalidation/export-service/share-service）
- 端点：`/api/story-runs`（创建/列表/详情）、`/turns`（SSE）、`/turns/[turnId]/retry-state|close-chapter`、`/resume`、`/export`、`/shares`（POST/DELETE）
- 灰度旗标：`src/lib/stories/rollout-flags.ts` + 三个 route 薄层 3 行落点（F1 RUNS/F2 TURNS/F3 CLOSE），F4 worker 开关在 `src/instrumentation.ts`
- 接线：`message-service.ts` 通过 `registerStoryHistoryInvalidator` 依赖倒置（组合根 side-effect import 在 `messages/[messageId]/route.ts`）；依赖方向只许 stories→conversations
- 测试：story 全套 37 条（run 8/turn 8/lifecycle 9/quota 1/w07 6/rollout 5）
- 契约：`docs/planning/m3-data-contract.md`（§7 依赖方向拍板、§12 分享模型）

## 5. 验证基线（改动后用这些自证）

```
npx tsc --noEmit                                      # 类型
node scripts/check-definition-of-done.mjs             # 完成定义（8 项）
node scripts/run-production-guards.mjs                # 生产门禁 2 条
node --import tsx --test tests/chat-application-service.test.mjs tests/conversation-message.test.mjs tests/conversation-service.test.mjs
node tests/m0-route-behavior.test.cjs                 # 14 条
node --test tests/m2-context.test.cjs                 # 4 条
node --import tsx --test tests/stories-v0.test.mjs    # 5 条
node --import tsx --test tests/story-run-service.test.mjs tests/story-turn-service.test.mjs tests/story-lifecycle-service.test.mjs tests/story-state-quota.test.mjs tests/story-lifecycle-w07.test.mjs tests/story-rollout-flags.test.mjs   # story 全套
node --import tsx --test tests/database-upgrade.test.mjs tests/account-closure.test.mjs tests/account-data-export.test.mjs
node scripts/verify-story-eval.mjs run                # W08 评测：基线 PASS=15 FAIL=0 PENDING=44 BLOCKED=1
DISABLE_MOCK_AI=false node scripts/run-browser-matrix.mjs test:browser   # 9 PASS / 1 SKIP
```

构建坑：`npm run build` 会撞 safe-delete 垫片的 genie-trash 间歇故障 → 用 `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run build`（仅构建产物目录，不对用户文件用）；先 `rm -rf .next-build` 防僵尸进程占锁。

浏览器矩阵的几个坑（**踩过，不要再踩**）：
- 必须显式 `DISABLE_MOCK_AI=false`，否则本地 `.env` 里是 true，聊天返回 503。
- `test:m2:chat` 硬要求 18782 端口，矩阵用随机端口，跑不通是既有问题。
- `test:screenshots` 会因 `NEXT_PUBLIC_SITE_URL` 是 localhost 而 307 失败，既有问题。
- `npm test`（`tests/runner.ts`）要求 `localhost:3000` 有服务，否则 147 条全 fetch failed，不是回归。
- 发现页场景区是客户端渲染，**curl/grep HTML 永远找不到**，必须用浏览器。

## 6. 当前阻塞与已知问题

1. **生产管理员密码仍是 `123123`**，未轮换。这是线上安全缺口，也是发布前置项（用户此前明确跳过，需上线前重新确认）。
2. ~~V0 四个漏斗指标没有埋点~~ → **已解决**：四指标埋点已实现并合入（`4af8a64`），管理端报表可看（`be80b61`），生产部署后即生效。
3. **发布候选复审有一处偏差**：映雪那条公开问题改完后未再走完整复审即上线，已记在 `docs/planning/v0-acceptance-record.md`。
4. **生产环境没有 AI 密钥**：`app.env` 里 `OPENAI_API_KEY` 为空，但数据库里有 provider 记录（`ces`）和模型 `gpt-6.1-sol`，走的是后台配置的 provider。真实模型调用能否成功未验证过——M5 灰度观察期第一个要看的就是这个。
5. **W08 人工复核队列 7 条**：model-simulated 语义断言不自动判分，需人工确认（防造假设计使然）。

## 7. 上线流程（已就绪，勿用本节旧版）

**本节旧版 M3 单独上线流程已作废**：M3 单独上线是无 worker 的半功能态（stateStatus 永停 PENDING）。统一走 `docs/planning/releases/m5-pilot-runbook.md`：
- 情形 1（M3 已上线过）或情形 2（M3+M4+M5 一次窗口，3 条迁移同批）由 `release:check` 输出判别
- Phase A 本地（含 `verify-story-eval` 口径）→ Phase B 服务器预装（含 worker 双态预验证）→ Phase C 窗口（停写→备份→release:check→迁移→PM2 切换→断言 M1–M8→60 秒观察）→ 异常走 Phase E 降级（红线：先关 worker/写入再切回旧应用）
- 每步带成功判据与失败处理，勿跳步

## 8. 下一步（按序）

| 阶段 | 内容 | 状态 |
|---|---|---|
| ~~拍板~~ | ~~发布批次~~ | **已拍板：方案 A 合并上线，2026-10-21 03:4x 完成** |
| ~~发布~~ | ~~按 `m5-pilot-runbook.md` 情形 2 执行~~ | **已上线 c5，C0–C8 全过**（记录见 `releases/cutover-record-20261021.md`） |
| ~~模板~~ | ~~生产无已发布故事模板~~ | **已发布林澈试点模板 v1**（`story:publish`） |
| 前置 | 管理员密码轮换（`admin-password-rotation-plan.md` 就绪） | **等用户** |
| 灰度 | F1–F4 开关已实现（`b5f12db`）；观察指标与扩量/暂停门槛见 `story-rollout-flags.md` §3/§4 | 需先定试点名单与告警责任人 |
| 待发 | 下列 4 项已提交但**不在生产 c5 里**，下次发布一起带上：worker 启动日志（`51b4747`）、`story:publish` 工具（`35366e2`）、M4 记忆闭环 buildContext（`ab2f64b`）、失效钩子注释修正（`a443a7e`） | 攒批 |
| 已修 | M4 记忆闭环缺口：worker 抽出的确认事实此前从不进入生成提示词（只喂了近期消息），现已由 `context-service.ts` 接上 | 已提交 |

已清项：灰度旗标 F1–F3（原待办）已实现；导出/分享/下架/级联（W07）已完成并终验。

遗留尾巴（低优先级，排期即可）：
1. `deleteMessageAndFollowing` 同毫秒相邻消息一并删除的精度问题（终验 §5.6；建议按 turnNo/message ID 收紧）
2. W08 剩余 38 例 skeleton：依赖项已陆续满足（W07 分享/撤回已终验覆盖，可直接引用 baseline §6.3 B 组断言口径补执行器）
3. W08 人工复核队列 7 条（model-simulated 语义断言，需人判）
4. 真实模型评测（model-real）：需用户授权真实 AI 调用 + 预算 env，闭环已就绪
5. api-paths 存量 fetch 渐进迁移：只在因其他原因触碰文件时顺手做，禁止批量搅动

## 9. 文档索引（按用途）

- 规划书：`docs/planning/角色关系连续剧产品与实施规划书_完整详细版_V1.0.docx`；可 grep 纯文本版 `.temp/plan-final.txt`（未纳入版本控制，勿删）
- 工作流：`docs/planning/roadmap.md`（W01–W09、M0–M5、R0–R4 批次与验收门）
- 数据契约：`docs/planning/m3-data-contract.md`（拍板结论权威）；行为对照：`docs/planning/m0-behavior-parity.md`
- 发布：`docs/planning/releases/`（m5-pilot-runbook 主流程、story-rollout-flags、m3-m4-release-checklist、m3-launch-runbook 备用、admin-password-rotation-plan）
- 内容与评测：`docs/content/drafts/`（6 章初稿 + EV-01~15 种子）、`tests/story-evaluation/traceability-matrix.md`（A01–A13 追溯）
- 回归与终验记录：`.workbuddy/memory/baseline-2026-10-20.md`（第一~六节）；每日工作日志 `.workbuddy/memory/2026-10-20.md`
- 结构审查：`docs/planning/structure-audit-2026-10-20.md`（模块边界结论）
- 生产验证参考：`docs/planning/v0-acceptance-record.md`

> 历史：2026-10-20 三轮多智能体协作（11+8 任务）全部完成解散，接手者可直接用新鲜 agent 开工，无需恢复任何旧团队。

## 10. 工程约定（这个仓库特有的）

- 文案层不能有 `zhText`；不要写泰国字符（现有词典除外）；前台不能引用后台组件。
- 组件只用 `@/components/ui` 原语，不引新依赖。
- 不用 `localStorage` 伪装跨设备进度，不把 AI 编造的总结当数据库事实。
- 迁移只许增量，不许 `ALTER` 既有表（除非有明确批准与回滚方案）；新增迁移先报批，当前 48 条。
- 删代码要删干净：被替换的实现、死导出、临时脚本一并清掉，不留沉淀；临时验证产物（.next-qa-* 等）用完即删，不得改 tsconfig/配置文件为其留口。
- api-paths 约定（`src/lib/api-paths.ts` 头注）：新代码强制走 API 常量，存量触碰时顺手迁，未消费条目是路由登记表不删。
- 依赖方向：stories→conversations 单向（m3-data-contract §7）；失效规则归 stories、消息操作归 conversations；analytics 域不跨域依赖。

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

M5 试点交付文档（W09，release-prep）：`docs/planning/releases/` 下 `m5-pilot-runbook.md`（R4 发布 runbook，含 Phase E 降级/回滚）、`story-rollout-flags.md`（灰度开关设计）、`m3-m4-release-checklist.md`（上线批次对照）。生产已切到 `commercial-20261021-c5`，生产库 48 条迁移；本次时间线与实测门记录见 `docs/planning/releases/cutover-record-20261021.md`。

## 13. 2026-10-20 M5/W07 完成记录与终验结论

- **W07**（`73b1cf8`）：导出白名单（导出 JSON 逐字段断言，隐藏剧情/提示词/stateJson/lease/requestHash 永不输出，账户档案 version 2→3）；story_shares 表（第 48 条迁移，纯增量）+ 分享创建/撤回（WITHDRAWN 对读者 404，撤回零副作用）；下架读写分离（`requireVisibleRun` 放宽读 + `requirePublishedTemplate` 写门，422 STORY_OFFLINE）；删除级联核对结论=既有外键级联已完备，用测试锁定。**顺手修复 M4 遗留真 bug**：turn-service.commitTurn 曾把助手回复同时写 USER+ASSISTANT 两条消息（用户输入从未落库），已修复并用终验 E 组攻击实测锁定。
- **灰度旗标**（`b5f12db`）：F1/F2/F3 route 薄层各 3 行，命中 503+flag 标识、零额度预留写入先于拒绝，不设开关行为逐字节不变。
- **终验**（baseline §6）：基线 11 项全绿（story 全套 37/37）、W08 与基线逐字一致、边界攻击 5 组全过（毒化 fixture 14 私有标记 0 命中、分享越权全拒、F2/F3 独立设计确认非漏洞、下架边界、turn 完整性）。
- **发布文档计数**：已同步 47→48（story_shares 并批，`9cb5029`）。

### 13.1 环境坑（接手 AI 必读，全部踩过）

1. **safe-delete 垫片**：本机 node 的删除操作被 WorkBuddy 垫片拦截走 genie-trash（间歇超时/文件不存在报错）。构建/清理构建目录用 `CODEBUDDY_SAFE_DELETE_ENABLED=0` 前缀；用户文件删除仍应走回收站保护。
2. **Prisma schema engine 不可用**：`prisma migrate deploy` 本机无法运行（绝对路径也报 unable to open database file）。测试建库一律走 `scripts/helpers/create-isolated-db.mjs`（node:sqlite 顺序执行迁移 SQL），database-upgrade/account-* 测试已按此先例改造。
3. **僵尸构建进程**：失败构建可能留下 next build 进程占 `.next-build\trace`（EPERM 连锁失败）。先查并清 `Win32_Process` 里命令行含 ai-role-community 的 node 进程再构建。
4. **端口**：测试用随机端口，避开 3000/18782；`npm test` 需要 localhost:3000 有服务。
5. **并行写入期单次测试结果不可采信**（baseline §5.4 教训）：文件稳定后复跑为准。
6. **SSE 测试纪律**：测试必须把 turn SSE 流读到 done 再结束（排空响应体），否则后台生成进程重开已删库文件（EBUSY/P2021）。

### 13.2 验收纪律（多 AI 协作时的分工红线）

- 验证不同 worker 刚写的代码 → 拉新鲜视角的独立验收员，不让实现者自证收尾。
- 写作域隔离：同一目录只允许一个写入者（conversations 域串行纪律）；越域触碰需先留证基线并保持旧语义零变化。
- 迁移报批制：新增迁移先报 lead 批准（纯增量、零 ALTER/DROP、grep 自证），当前 48 条。
- 架构红线：依赖只许 stories→conversations 单向；失效规则归 stories、消息操作归 conversations（m3-data-contract §7）。
