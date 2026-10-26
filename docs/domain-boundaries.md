# 业务模块边界

本文维护已有业务能力的所有者、依赖方向与未实现边界；具体接口和配置以对应源码与contracts为准。项目结构见 [架构说明](architecture.md)，运行与验收见 [运行手册](runbook.md)。

## 依赖方向

```text
apps/web、apps/admin（页面与交互）
        ↓ 只使用 contracts 与 HTTP
apps/api（鉴权、解析、限流、响应映射）
        ↓
packages/backend/src/modules/*（业务规则与事务）
        ↓
packages/backend/src/infrastructure/*（数据库、邮件、对象存储等适配器）
        ↓
database/schema.prisma + migrations
```

`packages/contracts` 只放跨应用共享的路径、请求/响应契约与能力标识，不依赖任一应用或后端实现。领域模块之间只通过公开服务调用；页面不得直接写数据库，基础设施不得反向依赖领域模块。

## 账号身份与恢复

```text
apps/web/src/app/(app)/forgot-password
apps/web/src/app/(app)/reset-password
apps/web/src/app/(app)/verify-email
apps/api/src/app/api/auth/password/{forgot,reset}
apps/api/src/app/api/auth/email/{resend,verify}
packages/backend/src/modules/accounts/account-recovery-service.ts
packages/backend/src/infrastructure/email/account-email-delivery.ts
database: AccountActionToken、User.emailVerifiedAt
```

- API 负责来源限流和不泄露账号是否存在的统一响应。
- accounts 服务负责令牌签发/摘要、有效期、一次性消费、密码哈希和会话撤销。
- email 适配器负责投递；当前仅提供显式开启的开发内存 outbox，生产不记录、不打印原始令牌。接入真实事务邮件供应商后才可把“注册后强制验证邮箱”设为上线门槛。
- 不在 UI 或路由中复制密码规则；沿用设置中心 `accounts.passwordMinLength`。

## 邀请码与上下级关系

所有者为 `packages/backend/src/modules/referrals`；旧 `growth/invite-service.ts` 只保留奖励与兼容转接：

```text
modules/referrals/service.ts                  邀请码状态、原子消费、直接关系与查询
apps/api/.../referrals                        我的码、校验、关系列表
apps/admin/.../growth/referral-affiliate      只读关系查询与账本
database: InviteCode、ReferralRelationship    显式状态和时间，不再只靠 User 两列
contracts: referral requests/responses        Web/Admin 共用
```

注册事务会原子消费有效邀请码并写唯一关系；数据库唯一键保证一个下级只能绑定一次。服务沿祖先链检查自邀和环路，停用邀请码不追溯破坏既有关系。迁移回填现有 `User.inviteCode/invitedByUserId`，两列暂作旧调用兼容。用户可查看/停用自己的码，并配置截止日与使用上限；后台只能查询关系，不能静默改绑。

尚未授权的归属变更保持不实现：注册后补绑、管理员改绑、删除关系与邀请码轮换均会改变商业归属，需要另定审计和通知规则。

## 网站账号创建与关闭

网站用户创建与状态管理继续归现有 `modules/accounts/management-service.ts`，没有混入管理员角色模块。具备 `accounts.manage` 的操作者只能创建“待激活”账号：随机不可用初始密码、24 小时摘要令牌、用户自行设密、一次性并发消费、激活后邮箱确认。生产邮件未配置时返回明确 503，账号保持停用，不伪装已发送。软关闭要求理由与版本锁，禁止关闭当前操作者，沿用最后一个所有者保护，撤销前后台会话，只标记状态而保留关联业务数据与审计。

仍待产品确认：待支付/退款/申诉存在时是否额外阻止软关闭、关闭后的恢复审批流程、后台创建时是否允许指定邀请归属。当前实现没有绕过邮箱激活，也没有删除用户业务数据。

## 一级分销

独立 `modules/affiliate` 只读取 referrals 的直接关系，并由订单/退款的已确认事务事件调用：

```text
modules/affiliate/service.ts   设置快照、订单幂等计提、按累计退款比例冲回、查询
settings registry/service      唯一策略编辑入口、版本冲突、历史审计与组合校验
database                       AffiliateAccrual、AffiliateReversal
```

只计算直接上级，绝不向间接上级计提。公共设置以百分比展示佣金，配套配置订单类别、等待小时与最低人工处理金额；默认全部未配置且关闭，启用时缺任一项会被设置服务拒绝，比例最多两位小数。每笔订单保存基数、比例（基点）、金额、币种、关系和可结算时间快照，后续改设置不追溯旧订单。`sourceType + sourceOrderId` 防重复回调；部分/全额退款以唯一退款键累计比例冲回。

账本支持 PENDING、AVAILABLE、PROCESSED 以及部分/全部冲回的查询口径，但当前实现没有自动提现、第三方转账或把“标记已处理”冒充真实付款。税费、收款资料、人工打款复核和真实提现供应商仍需单独决策与授权。

## 会员套餐生命周期

后台可新增自定义编号套餐，初始可保持未定价/停用；保存与停用沿用版本锁。删除仅允许“已停用且从未产生订单”的套餐，任何订单快照引用都会返回冲突并保留历史。没有自动填价格、权益或退款承诺。

## 增长玩法插件边界

```text
packages/contracts/src/growth/modules.ts              跨端声明：id/menu/permission/config/tasks/events
packages/backend/src/modules/growth/modules/registry.ts 可信静态适配器注册表
packages/backend/src/modules/growth/modules/state-service.ts 配置校验、启停、版本锁与审计
apps/api/src/app/api/admin/growth/modules              鉴权与 HTTP 错误映射
apps/admin/src/components/growth/module-management.tsx 运营启停界面
database: GrowthModuleState                             只保存状态和声明过的 JSON 配置
```

现有任务、签到、礼物已注册为三个内建适配器。停用后，新的任务领取、签到和赠礼在事务内被拒绝；用户任务列表/礼物目录不再暴露新入口，但领取、签到、赠礼和金币流水历史不删除。数据库没有代码路径、包名或脚本字段，不能从后台上传或动态执行任意插件。新增玩法仍需经过代码审查，把可信适配器登记到静态注册表；这提供小改动扩展边界，不把系统变成不受控的第三方代码加载器。

当前三个模块的配置 schema 是严格空对象：先建立配置协议，不编造尚未确认的活动规则。后续模块可只新增声明过、服务端验证过的布尔/整数/文本字段。计费能力仍通过现有金币账本领域服务，不允许模块直接改余额。

## AI 供应商成本阶梯

`AiModelPrice` 继续作为追加式、按币种和生效时间版本化的价格头；可选 `AiModelPriceTier` 记录连续的 `[minInputTokens, maxInputTokens)` 区间、输入/输出单价及可选缓存输入单价。没有阶梯的旧价格仍按原单价计算，迁移不会替换历史版本。

每次完成 AI 调用时按输入 Token 命中一个阶梯，并在 `AiCall.modelPriceTierId/costAuditJson` 保存价格版本、阶梯、区间、Token 数和实际使用的费率，便于重算与审计。缓存 Token 仅在上游明确返回该指标时使用；未提供缓存价时按普通输入价计算。后台提供结构化阶梯编辑，服务端强制首档从 0 开始、区间连续不重叠、末档无上限、最多 20 档。

本实现没有预填用户口述的 275k 或任何金额，也没有改变用户侧“每次回复扣币”的 `ModelCoinPrice`。供应商 Token 成本与用户币价仍是两套独立版本。

## 消息媒体与语音边界

建议归 `modules/conversations/attachments`，存储仍由 `infrastructure/storage` 适配：

```text
contracts: MessageAttachment {type, assetId, mime, size, metadata}
database: MessageAttachment（关联 Message/UploadAsset）
api: 上传授权、附件提交、访问校验
web chat: emoji picker、贴纸选择、图片上传/理解、录音/转写、渲染与失败重试
```

当前实现沿用 `/api/upload` 的 JPG/PNG/WebP 魔数、动态体积上限、账号所有权与频率限制；消息附件通过独立请求号幂等写入 `MessageAttachment`，刷新后仍可展示。emoji是纯文本Unicode；贴纸来自后台可编辑目录，历史消息保存快照。AiModel已有supportsChat/supportsVision/supportsTranscription；图片理解和录音转写通过独立媒体任务、有效模型、预算和日额度执行。普通附件上传不等于调用视觉模型，直接多模态聊天历史仍需另行实现。

当前附件已支持AUDIO、录制试听、真实WAV时长检查和本人授权读取；图片理解/转写任务有MediaTaskRequest与AiCall记录。外部TTS、声音转换和完整转码/审核流水线不能据此视为已实现。语音电话仍涉及实时会话、信令、TURN与独立计费设计，不塞进消息上传接口。角色扮演待补能力与阶段见[能力总登记](roleplay/capability-register.md)。

## 金币套餐权益与订单快照

`CoinPackage.benefitsJson` 保存运营明确填写的 0–8 条权益；商城只展示已有数据，同时明确拆分基础币、当前赠币和总到账币。创建订单时把权益 JSON 与基础币、赠币、价格一起复制到 `PaymentOrder`，后续修改套餐不改历史订单；管理导出保留权益快照。空数组表示没有额外承诺，不自动生成会员、退款或限时优惠文案。

## 验收规则

每个唯一业务操作都记录：页面与控件、前置权限、API、持久化表、正常结果、刷新持久化、失败提示、重复提交/幂等、清理方式。路由可打开、构建成功和 Tab 可点击不等于业务通过；外部付费、真实支付或不可逆生产动作明确标为阻塞项。
