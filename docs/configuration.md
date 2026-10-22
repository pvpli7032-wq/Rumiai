# 配置说明

> 依据：V3 终稿第 7/8/9/11 章与 `docs/planning/commercial-implementation-plan.md` §4。
> 一句话原则：**运营参数只存数据库、只在后台设置中心编辑一次**；环境变量只保留与部署环境/密钥相关、后台不该看到的项。

## 1. 配置分三层

| 层 | 位置 | 谁改 | 说明 |
|---|---|---|---|
| 部署与密钥 | 服务器 `shared/app.env` | 运维 | 数据库路径、上传目录、会话密钥、AI/支付凭据加密主密钥、模拟开关 |
| 运营参数 | 数据库 `operation_settings` | 负责人（后台设置中心） | 字数、频率、额度、币价、玩法开关、提示词 |
| 用户特例 | 数据库 `user_setting_overrides` | 有 `accounts.settings.manage` 的管理员 | 只允许额度、计费模式、折扣倍率与指定玩法次数，可设到期时间 |

读取优先级：**用户特例 > 公共值 > 登记默认值**。到期或删除特例即回落公共值，不需要重启。

## 1.1 部署配置（不可在后台改）

这一节是**故意不进设置中心**的项：它们要么是部署环境与密钥，要么一旦中途改变会让历史数据失去可比性。列出来是为了让「后台为什么看不到」有据可查，不是遗漏。

| 项 | 位置 | 为什么不在后台 |
|---|---|---|
| `DATABASE_URL`、`UPLOADS_DIRECTORY` | `shared/app.env` | 部署环境事实：路径换了，进程读到的就不是同一个库、同一批文件。 |
| `JWT_SECRET` | `shared/app.env` | 会话密钥；改它等于让所有已登录会话失效，是运维动作。 |
| `AI_PROVIDER_ENCRYPTION_KEY`、`PAYMENT_MERCHANT_ENCRYPTION_KEY` | `shared/app.env` | 库里凭据的加密主密钥；后台能改就等于后台能换锁，历史凭据会不可读。 |
| `DISABLE_MOCK_AI`、`ALLOW_SIMULATED_PURCHASES` | `shared/app.env` | 生产闸门：不模拟 AI、不模拟充值。放后台等于留一个「把假数据打开」的开关。 |
| `EZFP_ENABLED`、`EZFP_REFUNDS_ENABLED`、`EZFP_PID` | `shared/app.env` | 真实支付总开关与商户号；开启前要先把套餐人民币价与正式商户配好，属于发布动作。 |
| `NEXT_PUBLIC_SITE_URL` | `shared/app.env` | 构建期与链接生成用的站点地址，改它要重新构建。 |
| `AI_PRICE_CURRENCY` | `shared/app.env` | 成本记账的币种单位，理由见下。 |
| `AI_MODEL`、`AI_FALLBACK_MODELS` | `shared/app.env` | 兜底默认模型；任务级模型已迁到设置中心 `ai.taskModel.chat` / `story` / `mirror` / `disputeVerdict` / `memorySummary`。 |
| `AI_CONNECT_TIMEOUT_MS`、`AI_REQUEST_TIMEOUT_MS`、`AI_STREAM_IDLE_TIMEOUT_MS`、`AI_MAX_RETRIES`、`AI_MAX_TOKENS` | `shared/app.env` | 上游连接与超时行为，跟着部署环境和供应商走。 |
| `AI_DAILY_COST_BUDGETS`、`AI_BUDGET_CIRCUIT_BREAKER` | `shared/app.env` | 兼容兜底与显式熔断开关。正式预算在「AI 与商业 → 价格与成本」页按币种保存站点/用户上限（`AiDailyCostBudget`），一旦有库内记录即以数据库为准，env 只作迁移期兜底。 |
| `MODERATOR_USER_IDS`、`PAYMENT_ADMIN_USER_IDS` | `shared/app.env` | 权限名单按用户 ID 配置，只由运维写入，永不接受客户端传入。 |
| `MIRROR_IP_SALT`、`MIRROR_ATTRIBUTION_SECRET` | `shared/app.env` | 匿名计数与归属 Cookie 的密钥；改了等于重置当日额度、作废旧归属。 |
| `STORY_WORKER_DISABLED`、`NEXT_DIST_DIR`、`MIRROR_PREVIEW_FONT_PATH`、`TEST_BASE_URL` | `shared/app.env` | 进程、构建与演练开关。 |

### 为什么 `AI_PRICE_CURRENCY` 故意不做成后台可改

`AI_PRICE_CURRENCY`（`src/lib/ai/ai-usage.ts:19`，默认 `USD`）决定所有 `estimatedCost` 的币种语义：建调用记录时它写进 `AiCall.currency`，成本预算按币种归集，Mirror 生成与预算服务也用它兜底。它是**历史成本记账的单位**，不是运营可调的展示参数：

- 中途改币种，等于把前后两段成本数字放进同一个账本却换了单位。`AiCall.currency` 已有记录不回写，新旧数字直接不可比，毛利、汇率换算与建议币价全部失去基准。
- 单个模型可以有自己的结算币种（价格表按模型与生效时间保存，价格行的 `currency` 会覆盖 `AiCall.currency`）。所以「某个模型换结算币种」是改价格行，不是改这个全局默认。
- 真要换记账币种，做法是停写、留档、按新币种重新起算，而不是后台点一下。

这是有意为之，不是漏做。

### 业务参数在设置中心（原 env 与模块常量已迁入）

以下原本是环境变量或模块常量，现由设置中心维护，改完立即生效、不需要重启：

| 设置键 | 原来源 | 说明 |
|---|---|---|
| `limits.upload.perWindow` / `limits.upload.windowSeconds` | `UPLOAD_RATE_LIMIT` / `UPLOAD_RATE_WINDOW_MS` | 上传频率，默认 20 次 / 60 秒。 |
| `limits.follow.perWindow` / `limits.follow.windowSeconds` | 关注频率常量 | 关注频率，默认 60 次 / 60 秒。 |
| `limits.report.perWindow` / `limits.report.windowSeconds` | `REPORT_RATE_LIMIT` / `REPORT_RATE_WINDOW_MS` | 举报频率，默认 20 次 / 60 秒。 |
| `limits.login.perWindow` / `limits.login.windowSeconds` | 登录频率常量 | 登录尝试频率。**已登记但当前未生效**：登录路由没有限流，这两项只保存不拦截。 |

读取入口是 `readRateLimitRules()`（`src/lib/settings/limits.ts`）：每个调用点在请求开始时读一次，同请求内共用一次 `readSettings`（15 秒缓存），改完立即生效。原来的模块级 env 常量已删除，不再有「后台改了、env 又盖回去」的第二来源。

同组还有 `limits.chat.*`、`limits.post.*`、`limits.comment.*`、`upload.maxMB`、`chat.maxMessageChars`、`chat.historyMessages`、`billing.hardDailyMessages`：都在设置中心编辑，不再从环境变量读。

部署侧的操作步骤见 `docs/deployment.md` 第 3 节与第 5.1 节。

## 2. 设置中心怎么用

- 入口 `/admin/settings`，需要 `settings.read`；保存需要 `settings.write`。
- 页面按五类分标签：聊天与内容、计费额度、增长玩法、账号运行、提示词。每类先显示常用项，高级项折叠。
- 有改动时底部出现固定保存条（放弃修改 / 保存本页）；离开前提醒一次。
- 保存是整组单事务 + 版本号：别人先改过会返回 409，界面提示刷新后重试，不会覆盖对方的修改。
- 每次保存写一条历史；恢复默认先展示影响范围，再按历史版本生成新版本。
- 同一项只有一个编辑位置，不存在「后台改了、环境变量又盖回去」的两套来源。

## 3. 计费相关配置

| 键 | 默认 | 含义 |
|---|---|---|
| `billing.chargingEnabled` | `false` | 聊天收费总开关。关闭只停止新预扣，已有费用单照常结算或释放。 |
| `billing.freeDailyMessages` | `0` | 每天免扣币的回复条数；`0` 表示没有额外免费条数。 |
| `billing.priceMultiplier` | `1000` | 用户收费倍率（千分比），只在用户特例里改；`0` 表示该用户免费。 |
| `billing.holdTimeoutMinutes` | `10` | 预扣超过该时长进入核对；触发核对不等于无条件退款。 |
| `billing.dayTimezone` | `UTC` | 免费额度按哪个时区切换业务日。 |
| `billing.cancelPolicy` | `CHARGE_WHEN_OUTPUT` | 已输出后取消怎么算。`CHARGE_WHEN_OUTPUT`：当日免费取消次数未用完则释放并占一次，用完按已输出结算；`RELEASE_ALWAYS`：一律释放。首个内容片段未送达时永远释放，不受此键影响。 |
| `billing.freeCancelPerDay` | `3` | 每人每天免费取消次数。只在「已输出后取消」这条路上消耗。 |
| `story.chargingEnabled` / `story.coinPrice` | `false` / `0` | 故事回合是否单独计费；币价为 0 时沿用普通聊天价。 |

模型收费币价在「AI 与商业 → 价格与成本」维护，按模型与生效时间保存；供应商成本价与收费币价**分列显示**，缺成本价显示「待配置」，样本不足显示「样本不足」，不展示虚构毛利。

### 任务级每日预算

`budget.task.chat` / `story` / `mirror` / `mirrorAnonymous` / `disputeVerdict` / `memorySummary` 六项，单位「成本币」，**可填小数**，留空表示不额外限制、填 `0` 表示暂停该任务。

- 触发只停该任务，消耗仍计入全站预算；不会因为匿名 Mirror 超额而连带停掉付费聊天。
- `budget.task.mirrorAnonymous` 留空时匿名入口关闭并提示「匿名体验暂未开放（待设置匿名预算）」；登录用户只看 `budget.task.mirror`。
- 用量按 `AiCall.task_type` 聚合，不新增表也不改 `AiDailyUsage`（那是聊天次数配额，不是成本）。

### 成本换算与建议价

| 键 | 默认 | 说明 |
|---|---|---|
| `cost.exchangeRate` | 空 | 成本币折人民币的汇率，可填小数。留空时价格页只并列展示成本与收入，不推算毛利。 |
| `cost.exchangeRateEffectiveAt` | 空 | 汇率生效时间（ISO 日期时间）。到点前沿用旧汇率；留空表示立即生效。 |
| `cost.suggestedPriceMinSample` | `30` | 样本达到该条数才给建议币价；样本不足仍允许手动定价。 |
| `billing.targetMarginPercent` | 空 | 目标毛利。留空不生成建议售价。 |

## 4. 玩法开关

| 键 | 默认 | 关闭后的行为 |
|---|---|---|
| `mirror.enabled` | `true` | 入口隐藏，已有结果仍可查看。 |
| `dispute.enabled` | `true` | 停止新发起，已有案例按创建时写入的规则快照结束。 |
| `memory.enabled` | `false` | 不再生成摘要、不再注入事实；已有数据保留。 |
| `growth.onboardingEnabled` | `false` | 新手引导入口隐藏；已完成的用户本来也不会被拉回。 |
| `growth.inviteEnabled` | `false` | 「我的」页邀请卡不渲染，注册时仍记录邀请归属但不发奖。 |
| `billing.chargingEnabled` | `false` | 见上一节。 |

### 增长与玩法

| 键 | 默认 | 说明 |
|---|---|---|
| `growth.interestTags` | `[]` | 引导可选的兴趣标签白名单。不在名单里的值一律丢弃。 |
| `growth.inviteRewardCoins` | `0` | 被邀请人完成首次聊天后给邀请人的币数。业务键 `invite-first-chat:{userId}` 保证只发一次。 |
| `growth.eventRetentionDays` | `180` | 玩法埋点保留天数，`event-cleanup` 巡检任务按此清理。 |
| `mirror.questions` | `[]` | 三道问题文本。条数不足时前台提示待配置，不自动补默认题。 |
| `mirror.exampleResults` | `[]` | 每个角色的示例结果；角色没有真实结果时展示并标注「示例」。 |
| `mirror.anonymousIpDailyLimit` | `10` | 同一 IP 匿名日次数，与 Cookie 通道取较严者。`0` 表示禁止匿名生成。 |
| `mirror.featuredCharacterIds` | `[]` | 首页推广角色名单（按顺序）。空表示按热度自动取 6 个。 |
| `dispute.participateRewardCoins` / `hotRewardCoins` / `hotRewardTopN` / `rewardDailyCapCoins` | `0` / `0` / `3` / `0` | 评理参与奖、热门奖、热门名额与每日发奖上限。金额 `0` 表示不发。 |

关闭入口不等于抹掉任务或账本：到期任务照常跑完，已有记录只读可见。

## 5. 额度与频率

- 聊天：`chat.maxMessageChars`（单条字数）、`chat.historyMessages`（带多少条历史）、`limits.chat.perWindow` / `limits.chat.windowSeconds`（频率）、`billing.hardDailyMessages`（每日请求上限，`0` 表示暂停新请求，**不是无限**）。
- 社区：`content.post.maxChars`、`content.comment.maxChars`、`content.post.maxImages`、`limits.post.*`、`limits.comment.*`。
- 角色：`content.character.*`（名称、简介、人设、背景、开场白的字数上限）。
- 上传：`upload.maxMB`。

## 6. 账号运行

| 键 | 默认 | 说明 |
|---|---|---|
| `accounts.passwordMinLength` | `6` | 注册与改密的最少位数。 |
| `accounts.sessionDays` | `7` | 会话有效天数。 |

管理员初始密码由账号初始化流程设置并使用现有密码哈希存储；**不创建每次启动自动重置密码的逻辑**，也不把密码写进公共配置接口。

## 7. 提示词

`prompt.mirror`、`prompt.disputeVerdict`、`prompt.memorySummary` 分别控制 Mirror 生成、评理结案回应与记忆摘要的提示词。改动只影响之后的生成，已有结果不回写。

## 8. 后台任务参数

| 键 | 默认 | 说明 |
|---|---|---|
| `tasks.intervalMs` | `15000` | 任务轮询间隔。 |
| `tasks.batchSize` | `10` | 每批处理数量。 |
| `tasks.maxAttempts` | `3` | 有限重试次数。 |
| `tasks.backupRetention` | `7` | 备份保留份数。 |

七个巡检 kind 共用一张 `background_tasks` 表（`kind + subjectId` 唯一，DB 租约 120 秒）：`story-state`、`dispute-sweep`、`mirror-expire`、`charge-recovery`、`backup-cleanup`、`daily-backup`、`event-cleanup`。

- 普通巡检失败用尽重试后回到 PENDING 等下一轮；`daily-backup` 例外，失败用尽直接置 FAILED 并写 `lastError`，避免每 15 秒重打一次备份。
- `daily-backup` 首次建行是 `now + 24h`，不在启动瞬间就备份。
- 任务处理中重启后能继续；不能把「响应结束后无持久记录的 Promise」当作可靠任务。

## 9. 配置迁移顺序

改一组配置的固定顺序：建表与读取层 → 导入当前有效值 → 完成该组后台表单 → 替换该组后端读取与前端提示 → 确认保存后行为生效 → 移除该组旧环境变量兜底。

模型、套餐、品牌等原本就存在数据库里的配置保持唯一来源，不再走环境变量。
