# 模块与接口

> 权威依据：V3 终稿与 `docs/planning/commercial-implementation-plan.md`。本文件只记录**代码里已经存在的模块、路由与数据表**，不提前写尚未实现的接口。

## 1. 目录与依赖方向

```
src/lib/settings/        设置中心：registry / service / overrides / history / cache / validation / types
src/lib/billing/         计费：price / allowance / charge-service / recovery / turn / types
src/lib/mirror/          他眼中的你：service / generation / limits / share / repository / config
src/lib/disputes/        评理广场：case-service / vote-service / close-service / goal
src/lib/notifications/   站内通知：types（纯函数）/ service（读取与已读）/ write（写入与生产者）
src/components/admin/settings/   设置中心界面
src/components/admin/workbench/  工作台
src/components/admin/layout/     后台页头、筛选、表格、抽屉、保存条
src/components/mirror/           Mirror 前台
src/components/disputes/         评理前台
src/components/notifications/    顶栏通知铃铛与抽屉
```

硬红线：

- `settings` 不依赖任何业务域；`billing` 不拼剧情、不发模型请求；`conversations` 不 import `stories`；`tasks` 只 import 各域注册函数。
- 新增代码按目录分责，单文件不超过 300 行；客户端组件不得顺着引用链把 `node:*` 拉进浏览器包（通知模块就是按这条拆的）。
- 新路径一律走 `src/lib/api-paths.ts` 的常量，不新写 `/api/...` 字面量。

## 2. 数据表

迁移随发布一次性建齐，全部纯增量：`prisma/migrations/20261021180000_commercial_platform/migration.sql`。

| 表 | 用途 | 关键约束 |
|---|---|---|
| `operation_settings` | 运营参数公共值 | `key` 主键，带 `version` |
| `user_setting_overrides` | 用户特例 | unique(user_id,key)，`expires_at` 到期回落公共值 |
| `setting_revisions` | 设置修改历史 | index(key,created_at) |
| `model_coin_prices` | 模型收费币价 | unique(model_id,effective_at) |
| `generation_charges` | 费用单 | unique(user_id,operation,request_id)；状态 HELD/SETTLED/RELEASED/UNKNOWN |
| `user_daily_allowances` | 每日免费额度 | PK(user_id,day) |
| `mirror_results` | Mirror 结果 | unique(share_id)，`expires_at` 到期 |
| `dispute_cases` / `dispute_votes` | 评理案例与投票 | unique(post_id)；unique(case_id,user_id) |
| `conversation_memories` / `memory_facts` | 聊天记忆 | unique(conversation_id)；index(conversation_id,status) |
| `background_tasks` | 统一后台任务 | unique(kind,subject_id)，租约字段 `lease_owner/lease_until` |
| `notifications` | 站内通知 | index(user_id,read_at)、index(user_id,created_at) |
| `product_events` | 新玩法漏斗事件 | index(name,created_at) |

既有表只扩列：`coin_transactions`(+charge_id, charge_action，unique 组合)、`ai_calls`(conversation_id/user_id 可空，+task_type、anonymous_subject)。

## 3. 设置中心

- 登记表 `src/lib/settings/registry.ts` 是每个运营参数的唯一定义处（键名、分组、类型、默认值、范围、说明、是否允许用户覆盖、是否高级）。
- 读取：`readSetting(key)`、`readSettings(keys)`、`readGroup(group)`，返回 `{key, value, source, version}`，优先级 **用户特例 > 公共值 > 登记默认值**；进程内缓存 15 秒，保存后本进程立即失效。
- 保存：`saveGroup(group, changes, expectedVersions, operatorId)`，单事务、带版本号，冲突返回 409，成功写 `setting_revisions`。
- 业务代码只读值用 `readSettingValue(key)`；**禁止**把设置值导出成模块顶层常量。

| 方法/路径 | 说明 | 权限 |
|---|---|---|
| GET `/api/admin/settings?group=` | 分组字段、当前值、版本与说明 | `settings.read` |
| PATCH `/api/admin/settings` | 一次保存一组改动 + 期望版本 | `settings.write` |
| GET `/api/admin/settings/history` | 最近修改与恢复 | `settings.read` |
| POST `/api/admin/settings/restore` | 按历史版本生成新版本 | `settings.write` |
| GET/PUT `/api/admin/accounts/[id]/settings` | 用户特例读写 | `accounts.settings.manage` |
| DELETE `/api/admin/accounts/[id]/settings/[key]` | 回落公共值 | `accounts.settings.manage` |
| GET `/api/me/quota` | 前台余额、每条价格、免费次数、重置时间 | 登录 |
| GET `/api/ui-config` | 前台字数与开关白名单（不含后台内部配置） | 公开 |

## 4. 计费

分层：`price.ts` 计算每条币价（模型币价 × 用户倍率／1000，向上取整）；`allowance.ts` 维护每日免费额度的预占与消耗；`charge-service.ts` 是唯一的 `quote → hold → settle / release` 入口；`recovery.ts` 只查权威状态，负责 HELD 超时核对。

状态机：

- `HELD`：余额已条件扣减，写一条负数流水，费用单为 HELD。
- `SETTLED`：消息已保存，费用单置 SETTLED，负数流水归类聊天消费，**不再扣一次**。
- `RELEASED`：失败或取消，写唯一正数流水并置 RELEASED。
- `UNKNOWN`：结果不明，不重复扣、不自动补回，等 recovery 核对。

`requestId` 重放返回同一费用单与结果，不重复调模型、不重复扣币。计费开关关闭时不建费用单、不扣币，只记录 AI 成本。

**用户取消**（V3 表 8 / 表 16）：判定集中在 `src/lib/billing/cancel.ts`，聊天与故事共用一份。首个内容片段未送达 → 一律释放；已送达且策略为 `RELEASE_ALWAYS` → 释放；已送达且策略为 `CHARGE_WHEN_OUTPUT`（默认）→ 当日免费取消次数未用完则释放并占用一次，用完则按已输出结算。非用户原因（供应商失败、空回复、持久化失败）永远释放、不占次数。

**任务预算**（V3 表 9 / §22）：`src/lib/ai/task-budget.ts` 按 `budget.task.*` 给六类任务各设每日成本上限，用量从 `AiCall.task_type` 聚合、复用全站同一条币种换算。任务预算触发只停该任务，消耗仍计入全站预算；他眼中的你匿名预算未填或为 0 时匿名入口关闭并提示待设置。这些键是 `decimal`，可填 0.01 这类小数。

费用单的 `operation` 目前有四类：`CHAT_SEND`、`CHAT_REGENERATE`、`STORY_TURN`、`MIRROR`。Mirror 的超额购买走同一入口（`src/lib/mirror/purchase.ts`）：一次超额生成 = 一张 `operation=MIRROR` 的费用单，生成成功 settle、失败 release，免费额度那条路仍是进程内计数。

## 4.1 玩法埋点与漏斗

`product_events` 一张表承接全部玩法事件（V3 表 5 / 表 22）。写入口径：访问类事件由客户端上报，完成类事件由服务端在真实结果落库后写，不接受客户端自称完成。上报端点 `POST /api/events` 只收白名单内的事件名；后台 `GET /api/admin/analytics/product-funnel` 按 `COUNT(DISTINCT 'u:'||user_id / 'a:'||anonymous_subject)` 算漏斗，分母为 0 显示「样本不足」而不是 0%。事件保留天数由 `growth.eventRetentionDays` 决定，`event-cleanup` 巡检任务调用 `pruneProductEvents` 删除更早的记录。

## 4.2 增长：邀请与新手引导

邀请码是账号自带的稳定标识（`users.invite_code`），首次需要时生成一次后长期复用 —— 每次现算会让已发出去的链接全部失效。注册时按 `?invite=` 记录 `invited_by_user_id`；邀请码写错、自己邀请自己、邀请人已注销都只当没有邀请人，不让注册失败。被邀请人完成首次聊天后按 `growth.inviteRewardCoins` 给邀请人发一次币，业务键 `invite-first-chat:{userId}`，靠 `coin_transactions.reward_key` 唯一约束幂等。

新手引导是可选流程：`growth.onboardingEnabled` 关闭或用户已完成后端都不拦。兴趣标签只收 `growth.interestTags` 白名单里的值；推荐角色只取已审核公开的角色，按标签命中数排序，一个都没命中就按热度。

## 5. 站内通知

一套 `notifications` 表服务全部通知场景，首版只做四类：

| 类型 | 触发 | 点击去向 |
|---|---|---|
| `REVIEW_RESULT` 审核结果 | 角色审核通过或退回 | `/zh/character/:id` |
| `REPLY` 回复提醒 | 角色回复了用户 | `/chat?conversation=:id` |
| `COIN_RECEIVED` 到账 | 充值、奖励、退款入账 | `/shop/ledger` |
| `ACTIVITY_RESULT` 活动结果 | 活动结果公布 | `/leaderboard` |

- 写入只走 `src/lib/notifications/write.ts`：`createNotification` 与四个 `notify*` 生产者。
- 幂等：通知 id = sha256(用户 + 类型 + 事件键) 的前 24 位，主键冲突即视为已通知，重放不会重复推送。
- 未读计数与列表由同一个接口返回，顶栏红点、抽屉标记与「全部已读」都按服务端 `unreadCount` 校准。
- 不做邮件、短信或多渠道推送平台。

| 方法/路径 | 说明 |
|---|---|
| GET `/api/me/notifications?cursor=&take=` | 一页通知 + 全量未读数 |
| POST `/api/me/notifications` | 全部标记已读 |
| PATCH `/api/me/notifications/[id]` | 单条标记已读；不是本人的通知返回 404 |

## 6. 运营设置键

全部键在 `src/lib/settings/registry.ts` 登记（当前 96 个），分五组；下表只列分组与代表键，默认值与范围以后台界面为准（后台是唯一编辑入口）。每个键都有真实读取方，没有只登记不生效的键。

| 分组 | 键 |
|---|---|
| `chat` 聊天与内容 | `chat.maxMessageChars`、`chat.historyMessages`、`limits.chat.*`、`billing.hardDailyMessages`、`content.post.*`、`content.comment.maxChars`、`content.character.*`、`upload.maxMB`、`limits.post.*`、`limits.comment.*` |
| `billing` 计费额度 | `billing.chargingEnabled`、`billing.freeDailyMessages`、`billing.priceMultiplier`、`billing.holdTimeoutMinutes`、`billing.targetMarginPercent`、`billing.marginAlertPercent`、`billing.dayTimezone`、`billing.cancelPolicy`、`billing.freeCancelPerDay`、`budget.task.*`（六类任务每日成本上限，可填小数）、`cost.exchangeRate`、`cost.exchangeRateEffectiveAt`、`cost.suggestedPriceMinSample`、`story.chargingEnabled`、`story.coinPrice` |
| `growth` 增长玩法 | `grant.*`、`mirror.*`（含 `mirror.anonymousIpDailyLimit`、`mirror.featuredCharacterIds`、`mirror.questions`、`mirror.exampleResults`、`mirror.purchase*`）、`dispute.*`（含四个奖励键）、`growth.*`（引导开关、兴趣标签、邀请开关与奖励、事件保留天数）、`memory.*`、`tasks.*` |
| `accounts` 账号运行 | `accounts.passwordMinLength`、`accounts.sessionDays` |
| `prompts` 提示词 | `prompt.mirror`、`prompt.disputeVerdict`、`prompt.memorySummary` |

## 7. 后台导航与权限

- 侧栏只有六组：工作台 / 用户 / 内容与社区 / 增长与玩法 / AI 与商业 / 系统设置，数据源是 `src/lib/admin/nav.ts`；旧 URL 全部保留可达。
- 每组默认只展开当前所在组；「常用」区最多置顶 4 项，按管理员 id 存在 localStorage，超出给中文提示拒绝，置顶项仍按权限过滤（`src/components/admin/nav-pins.ts`）。
- 权限码在 `src/lib/admin/permissions.ts` 登记，按「读 / 写 / 敏感操作」拆分；退款审批与申请分离，申请人不能自批。
- 商业改造新增：`settings.read`、`settings.write`、`accounts.settings.manage`、`billing.read`、`billing.manage`、`mirror.read`、`mirror.manage`、`disputes.read`、`disputes.manage`、`tasks.read`、`tasks.manage`、`notifications.read`。
- 所有者（OWNER 角色）在代码层始终拥有全部权限（`src/lib/admin/authorization.ts`）：新增权限码不需要回库补授权，也不会出现「所有者看不到新页面」。其他角色仍按库里登记的权限码判定。
- 后台商业接口：`/api/admin/settings`（GET 分组读 / PATCH 分组写）、`/api/admin/settings/history`、`/api/admin/settings/restore`、`/api/admin/settings/export`、`/api/admin/settings/import`（预览）与 `/api/admin/settings/import/confirm`（一次事务写入，走与 PATCH 同一条 `saveChanges`）、`/api/admin/settings/prompts/preview`（试生成，记 AiCall 不扣币）、`/api/admin/analytics/product-funnel`、`/api/admin/accounts/[id]/settings`（单用户特例）、`/api/admin/mirror/results`、`/api/admin/disputes/cases`、`/api/admin/disputes/cases/[id]/close`、`/api/admin/tasks`、`/api/admin/tasks/[id]/run`、`/api/admin/ai/coin-prices`、`/api/admin/billing/charges`。

## 8. 接口约定

- 统一错误体 `{error, code}`，`error` 是中文可读文案，`code` 是稳定的机器码（`src/lib/http/errors.ts`）。
- 登录态只认 `Authorization: Bearer`；所有私有响应带 `Cache-Control: private, no-store`。
- 请求体统一走 `readJsonBody`（带大小上限与统一的中文解析失败文案）。
- 公开上报端点 `POST /api/events`：事件名必须在 `PRODUCT_EVENTS` 白名单内，匿名可调，按用户/IP 限流；埋点写失败只记日志，不影响主流程。
- 增长端点 `GET/POST /api/growth/onboarding`、`GET /api/growth/invite`。
- 路由实现约定：先鉴权，再校验入参，业务错误抛带 `status`/`code` 的领域错误，最后用 `jsonError` 兜底为 500 并只记日志。

## 9. 前台入口

| 页面 | 说明 |
|---|---|
| `/discover`、`/chat`、`/creator`、`/square`、`/profile` | 主导航（`src/lib/navigation.ts`）。`/square` 是广场，聚合圈子与评理；`/circles` 保留可达 |
| `/shop`、`/shop/ledger` | 金币充值套餐与流水 |
| `/my-reports`、`/community-appeal` | 我的举报与申诉 |
| `/my-characters` | 我的角色：作品、收藏、审核状态与重新提交 |
| `/chat-history`、`/ai-usage` | 单会话历史与 AI 用量 |
| `/[locale]/mirror`、`/[locale]/mirror/[shareId]` | 他眼中的你：答题、结果与分享 |
| `/[locale]/disputes`、`/[locale]/disputes/new`、`/[locale]/disputes/[id]` | 评理广场：列表、发起与投票 |
| `/zh/character/[id]` | 角色详情（按语言前缀路由） |
