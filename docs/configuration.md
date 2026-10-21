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
| `story.chargingEnabled` / `story.coinPrice` | `false` / `0` | 故事回合是否单独计费；币价为 0 时沿用普通聊天价。 |

模型收费币价在「AI 与商业 → 价格与成本」维护，按模型与生效时间保存；供应商成本价与收费币价**分列显示**，缺成本价显示「待配置」，样本不足显示「样本不足」，不展示虚构毛利。

## 4. 玩法开关

| 键 | 默认 | 关闭后的行为 |
|---|---|---|
| `mirror.enabled` | `true` | 入口隐藏，已有结果仍可查看。 |
| `dispute.enabled` | `true` | 停止新发起，已有案例按创建时写入的规则快照结束。 |
| `memory.enabled` | `false` | 不再生成摘要、不再注入事实；已有数据保留。 |
| `billing.chargingEnabled` | `false` | 见上一节。 |

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

任务处理中重启后能继续；不能把「响应结束后无持久记录的 Promise」当作可靠任务。

## 9. 配置迁移顺序

改一组配置的固定顺序：建表与读取层 → 导入当前有效值 → 完成该组后台表单 → 替换该组后端读取与前端提示 → 确认保存后行为生效 → 移除该组旧环境变量兜底。

模型、套餐、品牌等原本就存在数据库里的配置保持唯一来源，不再走环境变量。
