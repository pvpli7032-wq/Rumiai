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

## 增长玩法插件边界

新增玩法通过静态注册表声明 `id/menu/permissions/configSchema/events/billingCapability`；启停和配置存数据库。运行时调用受限能力接口（奖励账本、埋点、通知），不能加载后台上传的任意代码。现有任务、礼物、签到先做适配器迁移，避免一次性重写。

## 消息媒体与未来语音

建议归 `modules/conversations/attachments`，存储仍由 `infrastructure/storage` 适配：

```text
contracts: MessageAttachment {type, assetId, mime, size, metadata}
database: MessageAttachment（关联 Message/UploadAsset）
api: 上传授权、附件提交、访问校验
web chat: emoji picker、贴纸选择、图片上传、渲染与失败重试
```

当前交付应先做 emoji（纯文本 Unicode）、表情包和图片；校验 MIME、尺寸、像素、所有权及访问权限。未来语音消息复用附件模型，增加时长/波形/转码状态；语音电话是实时会话、信令、TURN、计费和风控的独立模块，不应塞进消息上传接口。

## 验收规则

每个唯一业务操作都记录：页面与控件、前置权限、API、持久化表、正常结果、刷新持久化、失败提示、重复提交/幂等、清理方式。路由可打开、构建成功和 Tab 可点击不等于业务通过；外部付费、真实支付或不可逆生产动作明确标为阻塞项。
