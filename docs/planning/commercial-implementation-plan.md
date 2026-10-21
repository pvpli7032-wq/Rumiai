# 商业改造实施契约（2026-10-21 · V3 落地版）

> 权威来源：`C:/Users/42422/Desktop/星伴商业改造计划书_V3终稿.docx`（纯文本提取 `.temp/docx_v3.txt`）。
> 本文件只规定**工程落地**：模块分区、数据表、接口签名、依赖方向、验收口径。与 V3 冲突时以 V3 为准。
> 实施顺序：先线上可用，再回收本地。所有写入者必须遵守第 9 节写作域。
> 状态（2026-10-21 收尾）：M1 设置中心与接线、M2 后台布局与业务页、M3 计费、M4 Mirror/评理/记忆/任务/通知均已落地；`npm run test:commercial` 覆盖六个域共 59 条用例。

## 1. 目标与边界

把「写死的运营参数」迁到数据库设置中心，让负责人在后台调参；接入聊天计费（预扣/结算/释放/核对）；上线「他眼中的你（Mirror）」「评理广场」；补普通聊天记忆与统一后台任务入口。

不做（V3 第 3 章明确收缩）：换 Cookie 登录、TOTP、设备指纹、全站响应头专项、全库格式化、全库死代码扫描、多地拨测、独立安全事件平台、Redis/向量库/配置中心、真实支付联调。

## 2. 模块分区（重点：不许把代码写在一起）

新增代码一律落到下列目录，**一个目录一个责任**，单文件不超过 300 行（超了就拆）：

```
src/lib/settings/        M1 设置中心：registry / service / overrides / history / cache / types
src/lib/billing/         M3 计费：price / allowance / charge-service / recovery / types
src/lib/mirror/          M4 他眼中的你：service / generation / share / types
src/lib/disputes/        M4 评理广场：case-service / vote-service / close-service / types
src/lib/memory/          M4 记忆：summary-service / fact-service / types
src/lib/tasks/           M4 后台任务：registry / runner / handlers / types
src/lib/notifications/   M4 站内通知：service / types
src/components/admin/settings/   设置中心 UI
src/components/admin/workbench/  工作台 UI
src/components/admin/layout/     AdminPageHeader / FilterBar / DataTable / DetailDrawer / SettingsGroup / SaveBar
src/components/mirror/           Mirror 前台组件
src/components/disputes/         评理前台组件
```

依赖方向（硬红线，违反即打回）：
```
settings ← (所有域)                     settings 不依赖任何业务域
billing  → settings, coins, ai           billing 不拼剧情、不发模型请求
conversations → billing, settings        conversations 不 import stories
stories → billing, settings              stories 不 import conversations 实现（只走既有依赖倒置钩子）
mirror/disputes → billing, settings, ai, community/posts
tasks → (注册式) 各域 handler            tasks 不直接 import 业务实现，只 import 注册函数
```
`src/lib/settings` 不得 import 任何业务模块；`src/lib/billing` 不得 import conversations/stories。

## 3. 数据表（一次迁移建齐，Lead 独占）

迁移 `prisma/migrations/20261021180000_commercial_platform/migration.sql`，纯增量 + 两处既有表扩列（已批准，见 §3.3）。

### 3.1 设置中心
| 表 | 关键字段 | 约束 |
|---|---|---|
| operation_settings | key(PK), group, value(JSON 字符串), version, updated_by | key 唯一即主键 |
| user_setting_overrides | id, user_id, key, value, expires_at, version | unique(user_id,key)；到期回落公共值 |
| setting_revisions | id, key, scope(GLOBAL/USER), user_id, old_value, new_value, operator_id, created_at | index(key,created_at) |

### 3.2 计费
| 表 | 关键字段 | 约束 |
|---|---|---|
| model_coin_prices | id, model_id, coins_per_reply, effective_at, version, created_by | unique(model_id,effective_at) |
| generation_charges | id, user_id, request_id, operation, status, coins, price_snapshot_json, allowance_source, conversation_id, message_id, ai_call_id, held_at, settled_at, released_at | unique(user_id,operation,request_id)；index(status,held_at) |
| user_daily_allowances | user_id, day, free_used, free_reserved | PK(user_id,day) |

status 取值固定：`HELD / SETTLED / RELEASED / UNKNOWN / FREE`（FREE = 免费模式未产生费用单，仅用于统计口径时**不建单**，见 §5.4）。
operation 取值固定：`CHAT_SEND / CHAT_REGENERATE / STORY_TURN / MIRROR / DISPUTE_VERDICT / MEMORY_SUMMARY`。

### 3.3 既有表扩列（唯一允许的 ALTER）
- `coin_transactions` + `charge_id TEXT`、`charge_action TEXT`（HOLD/SETTLE/RELEASE），unique(charge_id, charge_action)。既有行 charge_id 为 NULL，不参与唯一约束。
- `ai_calls`：`conversation_id` / `user_id` 改为可空（SQLite 需重建表），+ `task_type TEXT`、`anonymous_subject TEXT`。重建必须逐行复制并校验行数一致。

### 3.4 新玩法与任务
| 表 | 关键字段 | 约束 |
|---|---|---|
| mirror_results | id, share_id, user_id?, anonymous_subject, character_id, answers_json, title, observations_json, quote, indices_json, raw_json, status, charge_id, expires_at | unique(share_id)；index(status,created_at) |
| dispute_cases | id, post_id, author_id, character_id, excerpt_json, claim, rule_snapshot_json, deadline_at, vote_count, close_status, verdict_json, closed_at | unique(post_id)；index(close_status,deadline_at) |
| dispute_votes | id, case_id, user_id, choice, revise_count | unique(case_id,user_id) |
| conversation_memories | id, conversation_id, summary, covered_message_id, version | unique(conversation_id) |
| memory_facts | id, conversation_id, user_id, text, source_message_id, pinned, status | index(conversation_id,status) |
| background_tasks | id, kind, subject_id, status, attempts, next_run_at, lease_owner, lease_until, last_error | index(status,next_run_at)；unique(kind,subject_id) |
| notifications | id, user_id, type, title, body, target_type, target_id, read_at | index(user_id,read_at) |
| product_events | id, name, subject_key, user_id?, anonymous_subject, properties_json | index(name,created_at) |

## 4. 设置中心契约

### 4.1 registry（`src/lib/settings/registry.ts`）
每项：`{key, group, label, type: 'number'|'boolean'|'string'|'text'|'json'|'enum', unit?, default, min?, max?, options?, description, userOverridable: boolean, advanced: boolean}`。
group 固定五类：`chat`(聊天与内容)、`billing`(计费额度)、`growth`(增长玩法)、`accounts`(账号运行)、`prompts`(提示词)。
键名沿用 V3 表 7/8/9：`chat.maxMessageChars`、`chat.historyMessages`、`limits.chat.perWindow`、`limits.chat.windowSeconds`、`billing.hardDailyMessages`、`content.post.maxChars`、`content.comment.maxChars`、`content.post.maxImages`、`upload.maxMB`、`content.character.*`、`accounts.passwordMinLength`、`accounts.sessionDays`、`limits.post.*`、`limits.comment.*`、`billing.chargingEnabled`、`billing.freeDailyMessages`、`billing.priceMultiplier`、`billing.holdTimeoutMinutes`、`billing.targetMarginPercent`、`billing.marginAlertPercent`、`grant.signupBonusCoins`、`grant.dailyCapCoins`、`grant.perUserDailyCapCoins`、`billing.dayTimezone`、`mirror.*`、`dispute.*`、`memory.*`、`story.*`、`tasks.*`。

### 4.2 读取
```ts
readSetting(key): Promise<SettingValue>                 // 已合并默认值与用户特例
readSettings(keys: string[]): Promise<Record<string, SettingValue>>
readGroup(group): Promise<SettingValue[]>
SettingValue = { key: string; value: JsonValue; source: 'USER'|'GLOBAL'|'DEFAULT'; version: number }
```
进程内缓存 TTL 15 秒，保存后本进程立即失效。**禁止**把设置值导出成模块顶层常量（V3 表 10「不能将业务参数导出为模块启动时求值的常量」）。

### 4.3 保存
```ts
saveGroup(group, changes: {key,value}[], expectedVersions: Record<string,number>, operatorId): Promise<{saved: string[]}>
```
单事务；版本冲突返回 409；校验失败保留输入并返回字段级错误；成功写 setting_revisions。

### 4.4 接口
| 方法/路径 | 说明 | 权限 |
|---|---|---|
| GET /api/admin/settings?group= | 分组字段+当前值+版本+说明 | settings.read |
| PATCH /api/admin/settings | changes + expectedVersions 一次保存 | settings.write |
| GET /api/admin/settings/history?group=&key=&cursor= | 最近修改 | settings.read |
| POST /api/admin/settings/restore | {key, revisionId} 生成新版本 | settings.write |
| GET/PUT /api/admin/accounts/[id]/settings | 用户特例读写 | accounts.settings.manage |
| DELETE /api/admin/accounts/[id]/settings/[key] | 回落公共值 | accounts.settings.manage |
| GET /api/me/quota | 前台：余额、每条价格、免费次数、重置时间 | 登录 |
| GET /api/ui-config | 前台字数/开关白名单，**不含**任何后台内部配置 | 公开 |

新增权限码：`settings.read`、`settings.write`、`accounts.settings.manage`、`billing.read`、`billing.manage`、`mirror.read`、`mirror.manage`、`disputes.read`、`disputes.manage`、`tasks.read`、`tasks.manage`、`notifications.read`。

## 5. 计费契约（M3）

### 5.1 分层
```
billing/price.ts        每条币价 = ceil(ModelCoinPrice.coinsPerReply × 用户倍率/1000)，倍率来自 user override billing.priceMultiplier（默认 1000）
billing/allowance.ts    UserDailyAllowance 预占/消耗/释放，按 billing.dayTimezone 计算业务日
billing/charge-service.ts  quote() → hold() → settle() / release()，唯一入口
billing/recovery.ts     HELD 超时核对（不改调用，只查权威状态）
```

### 5.2 状态机（V3 表 17，逐字实现）
- `HELD`：余额已条件扣减 + 唯一负数流水 + 费用单 HELD。
- `SETTLED`：消息已保存 → 费用单置 SETTLED，负数流水归类为聊天消费（`source_key='CHAT_SPEND'`），**不再扣一次**。
- `RELEASED`：失败/取消 → 唯一正数流水 + 置 RELEASED。
- `UNKNOWN`：结果不明 → 不重复扣、不自动补回，等 recovery。
- 免费额度：先预占（free_reserved+1），成功才 free_used+1；失败释放预占。
- 相同 requestId 重放返回同一费用单与结果，不重复调用模型、不重复扣币。

### 5.3 接入点（只改这两个文件，不许复制余额逻辑）
- `src/lib/conversations/chat-application-service.ts`：SEND / REGENERATE 各一次 hold→settle/release。
- `src/lib/stories/turn-service.ts`：STORY_TURN 同样接入；故事价格由 `story.coinPrice` 设置决定，未设置则沿用普通聊天价。
两条链共用同一个 `charge-service`，**禁止**各自实现扣费。

### 5.4 开关
`billing.chargingEnabled` 默认 false（关闭）。关闭时：不建费用单、不扣币、只记录 AiCall 成本。开启后只影响新请求；已 HELD 的按实际结果结算。

## 6. 新玩法契约（M4）

### 6.1 Mirror（他眼中的你）
- 入口 `/[locale]/mirror`，结果页 `/[locale]/mirror/[shareId]`（公开只读）。
- 流程：选题 → 提交 3 题（每题默认 60 字）→ 一次生成 → 结构校验（失败最多修复 1 次）→ 保存 → 分享。
- 额度：匿名 `mirror.anonymousDailyLimit`(默认 1)、登录 `mirror.userDailyLimit`(默认 3)；超额按 `mirror.overLimitPolicy`(pause|charge)。
- 结果字段：称号(8 字)/三条观察(40 字)/金句(30 字)/两个娱乐指数；`mirror.resultRetentionDays`(默认 30)。
- 分享页只读结果字段，不展示三题原回答；删除后 404。

### 6.2 评理广场
- `/disputes` 列表（热门/最新/我参与）、`/disputes/[id]` 详情；案例复用 Post 承载评论点赞举报。
- 发起：从自己聊天选最多 `dispute.maxExcerptMessages`(6) 条连续消息 + 诉求(`dispute.claimMaxChars` 60 字)；资格 `dispute.dailyLimit`(3)/注册满 `dispute.minAccountAgeHours`(24)。
- 投票：三选一（我 / TA / 各打五十大板），每人一票，可改 `dispute.maxVoteChanges`(1) 次，不能投自己。
- 结案：`dispute.closeAfterHours`(48) 或 `dispute.closeAtVotes`(200) 先到先结；创建时把规则写入 `rule_snapshot_json`；到期进 background_tasks，条件更新抢占一次，生成回应(`dispute.verdictMaxChars` 120)，失败有限重试后使用明确的非 AI 兜底文案。

### 6.3 记忆与后台任务
- 普通聊天：`conversation_memories` 滚动摘要 + `memory_facts`；达到 `memory.summaryTriggerMessages`(20) 建任务；关闭 `memory.enabled` 后不再生成与注入。
- 统一后台任务入口：`src/lib/tasks/runner.ts`，由 `src/instrumentation.ts` 按 `tasks.intervalMs`(15000) 轮询；`src/lib/tasks/handlers.ts` 是唯一分派表，注册 story-state / memory-summary / dispute-close / dispute-sweep / mirror-expire / charge-recovery / backup-cleanup。后台「立即执行」调 `runKindNow`，与巡检共用同一套租约与重试，不另写一套分派。
- 任务必须持久化、可重入、有租约；禁止用「响应结束后无记录的 Promise」当任务。

## 7. 后台 UI 契约（M2）
- 侧栏只保留六组：工作台 / 用户 / 内容与社区 / 增长与玩法 / AI 与商业 / 系统设置。旧 URL 全部保留可达。
- 工作台：顶部标题+日期范围+刷新；第一行四指标（新增用户/有效回复/实收金额/AI 成本）；第二行待办(2/3)+系统状态(1/3)；下方最多一张趋势图。
- 设置中心：单内容区 + 顶部分类标签；每类先 6–10 个常用项，高级折叠；有改动时底部固定 SaveBar（放弃修改 / 保存本页）；离开提醒一次；恢复默认先展示影响。
- 价格与成本：收费币价与供应商成本价**分列**；顶部最多三张汇总卡；缺成本价显示「待配置」，样本不足显示「样本不足」，不展示虚构毛利。
- 复用原语，不引新 UI 依赖；不得新增另一套后台 UI 框架。

## 8. 验收口径（V3 表 25）
| 检查 | 通过条件 | 阶段 |
|---|---|---|
| 配置保存 | 改值后实际请求改变、刷新与重启仍保留、同一项只有一个编辑位置 | M1 |
| 用户覆盖 | 特例只影响该用户，到期恢复公共值 | M1 |
| 后台布局 | 工作台/列表/设置/价格页桌面可读，手机无整页溢出 | M2 |
| 聊天费用 | 成功只扣一次、失败取消释放、免费次数与余额一致、重复请求不重复收费 | M3 |
| 异常核对 | 一次中断恢复；已保存消息可结算；未知结果不盲目退款或重发 | M3 |
| Mirror 与评理 | 生成可分享、一人一票、结案一次、后台可改规则看结果 | M4 |
| 记忆与任务 | 关闭或删除后不再注入；任务到期可运行、失败可见 | M4 |
| 最终交付 | 生产构建一次、关键流程一次、迁移与备份恢复一次 | M5 |

静态检查只覆盖改动文件与受影响调用方；不为一个设置改动跑全站。

## 9. 写作域与协作红线
- 一个目录同一时间只有一个写入者；跨域改动先在共享任务里声明。
- 共享文件（`prisma/schema.prisma`、`src/lib/admin/nav.ts`、`src/lib/admin/permissions.ts`、`src/lib/api-paths.ts`、`package.json`、`src/instrumentation.ts`）由 Lead 独占写入，其他角色提交 diff 需求。
- 删代码要删干净：被替换的常量、死导出、临时脚本、旧页面一并删除，不留沉淀。
- 不新增依赖（组件只用 `@/components/ui` 原语）。
- 迁移只许增量；新迁移先报 Lead 批准。
