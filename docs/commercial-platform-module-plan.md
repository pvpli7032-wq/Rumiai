# 商业平台模块边界与交付顺序

本文固定新增能力的所有者、依赖方向与未决策边界。它不是把旧代码整体搬家的重构计划。

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

## 账号身份与恢复（本批已实现基础闭环）

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

## 邀请码与上下级关系（下一批，不能等同于现有奖励链接）

建议所有者为 `packages/backend/src/modules/referrals`，而不是继续把生命周期塞进单个 `growth/invite-service.ts`：

```text
modules/referrals/invitation-service.ts       邀请码创建、轮换、撤销、过期
modules/referrals/relationship-service.ts     一次绑定、自邀/成环校验、查询
apps/api/.../referrals                        我的码、校验、关系列表
apps/admin/.../referrals                      管理与审计（需独立权限）
database: InviteCode、ReferralRelationship    显式状态和时间，不再只靠 User 两列
contracts: referral requests/responses        Web/Admin 共用
```

注册事务应在创建用户时原子消费有效邀请码并写唯一关系；数据库唯一键保证一个下级只能绑定一次。服务沿祖先链检查自邀和环路，撤销邀请码不追溯破坏既有关系。迁移时将现有 `User.inviteCode/invitedByUserId` 回填后再决定是否移除兼容字段。

待产品确认：邀请码默认有效期、能否轮换、注册后补绑窗口、管理员能否更改已绑定关系及审计/通知规则。未确认前不实现会改变归属的管理动作。

## 网站账号创建与关闭（待安全策略确认）

后台目前管理既有账号状态，不应把“新增管理员”误当作“创建网站用户”。最小可逆实现应归 `modules/accounts/admin-lifecycle-service.ts`，由独立的 `accounts.create` / `accounts.close` 权限保护；创建采用一次性激活链接而不是由管理员获知用户密码，关闭沿用现有注销清理与账务保留规则，并要求理由、版本锁、二次确认和审计。

实施前须确认：是否允许无邮箱验证创建、邀请归属由谁指定、关闭是否等同用户自助注销、待支付/退款/申诉时如何阻止、被关闭账号能否恢复以及恢复审批人。未确认前不提供会绕过验证或账务守卫的按钮。

## 分销（规则未定，不伪造佣金）

建议独立 `modules/affiliate`，只依赖 referrals 的只读关系查询以及订单/退款的已确认领域事件：

```text
commission-policy-service.ts   版本化层级、比例、上限、适用商品
commission-accrual-service.ts  订单事件幂等计提、退款冲销
commission-settlement-service.ts 冻结、可结算、已结算状态机
withdrawal-service.ts          提现申请与审核（后续支付适配器）
database: policy/version, accrual, reversal, settlement, withdrawal
```

必须先确认层级、每层比例、适用订单、退款等待期、税费/最低提现、结算周期与币种。真实支付/提现不得用测试成功提示代替。

## 增长玩法插件边界（本批已交付内建模块协议）

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

## AI 供应商成本阶梯（本批已交付结构，未写入线上价格）

`AiModelPrice` 继续作为追加式、按币种和生效时间版本化的价格头；可选 `AiModelPriceTier` 记录连续的 `[minInputTokens, maxInputTokens)` 区间、输入/输出单价及可选缓存输入单价。没有阶梯的旧价格仍按原单价计算，迁移不会替换历史版本。

每次完成 AI 调用时按输入 Token 命中一个阶梯，并在 `AiCall.modelPriceTierId/costAuditJson` 保存价格版本、阶梯、区间、Token 数和实际使用的费率，便于重算与审计。缓存 Token 仅在上游明确返回该指标时使用；未提供缓存价时按普通输入价计算。后台提供结构化阶梯编辑，服务端强制首档从 0 开始、区间连续不重叠、末档无上限、最多 20 档。

本实现没有预填用户口述的 275k 或任何金额，也没有改变用户侧“每次回复扣币”的 `ModelCoinPrice`。供应商 Token 成本与用户币价仍是两套独立版本。

## 消息媒体与未来语音（本批已交付图片/静态表情）

建议归 `modules/conversations/attachments`，存储仍由 `infrastructure/storage` 适配：

```text
contracts: MessageAttachment {type, assetId, mime, size, metadata}
database: MessageAttachment（关联 Message/UploadAsset）
api: 上传授权、附件提交、访问校验
web chat: emoji picker、贴纸选择、图片上传、渲染与失败重试
```

本批沿用 `/api/upload` 的 JPG/PNG/WebP 魔数、动态体积上限、账号所有权与频率限制；消息附件通过独立请求号幂等写入 `MessageAttachment`，刷新后仍可展示。emoji 是纯文本 Unicode，表情包只能选静态目录中的 ID。当前模型没有“视觉能力”配置字段，所以图片仅保存与展示，接口明确说明不调用模型、不扣聊天金币，不伪装成模型已理解图片。

未来语音消息可复用附件模型，但启用前必须增加 AUDIO 类型、时长/波形/转码与内容审核状态；语音电话仍是实时会话、信令、TURN、计费和风控的独立模块，不塞进消息上传接口。

## 金币套餐权益与订单快照（本批已交付字段）

`CoinPackage.benefitsJson` 保存运营明确填写的 0–8 条权益；商城只展示已有数据，同时明确拆分基础币、当前赠币和总到账币。创建订单时把权益 JSON 与基础币、赠币、价格一起复制到 `PaymentOrder`，后续修改套餐不改历史订单；管理导出保留权益快照。空数组表示没有额外承诺，不自动生成会员、退款或限时优惠文案。

## 验收规则

每个唯一业务操作都记录：页面与控件、前置权限、API、持久化表、正常结果、刷新持久化、失败提示、重复提交/幂等、清理方式。路由可打开、构建成功和 Tab 可点击不等于业务通过；外部付费、真实支付或不可逆生产动作明确标为阻塞项。
