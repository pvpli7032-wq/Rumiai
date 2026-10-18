# 当前架构与维护边界

HTTP 入口在 src/app/api，页面在 src/app，交互组件在 src/components，模型与有序迁移在 prisma。采用 Next.js App Router；route.ts、page.tsx、middleware 与动态 sitemap 是框架入口，无普通 import 也可能正在使用。

| 域 | 实现 | 数据 |
|---|---|---|
| 认证与账户 | lib/auth.ts、accounts/registration/login/profile/session/closure/data-export/management | User、tokenVersion |
| AI | lib/ai：供应商配置、加密、模型白名单、成本预算与用量 | AiProvider、AiModel、AiCall、AiDailyUsage、AiDailyCostBudget、AiCostPolicy |
| 管理权限 | lib/admin：权限解析、管理身份、角色配置与审计 | AdminOperator、AdminRole、AdminAuditLog |
| 运维状态与维护 | lib/operations/report-service.ts：只读状态/备份及告警；maintenance-service.ts：维护配置事务与审计；maintenance-routing.ts：业务写入分类 | Prisma migrations、备份元数据、MaintenancePolicy；Node中间件读取维护状态并映射HTTP响应，管理路由仍自行鉴权 |
| 站点证书状态 | lib/operations/certificate-probe.ts：TLS握手与证书校验；certificate-service.ts：固定站点目标、权限、结果持久化与审计 | SiteCertificateStatus保存最近观察，历史进入AdminAuditLog；GET只读存量，POST由独立权限触发，不接收任意目标或执行续签 |
| 备份与隔离恢复记录 | lib/operations/state-backup.mjs：复制/校验及恢复结果；backup-inventory.ts：固定目录元数据投影；backup-read-service.ts：查看权限和分页 | 复用manifest.json，恢复成功后仅在新目标写restore-result.json；不改源库/源包，不重复写入业务表，不从网页执行恢复或读取文件内容 |
| 对话 | lib/conversations：会话创建/列表、提示词、模型流、SSE、消息所有权与编辑/删除/喜欢 | Conversation、Message |
| 任务与增长 | lib/missions、lib/checkins、lib/gifts、lib/growth：领取核验、奖励目录和金币来源汇总 | Mission、UserMission、Checkin、GiftCatalogItem、CoinTransaction.sourceKey |
| 运营分析 | lib/analytics：认证日活快照、注册 cohort 报表与发现榜单聚合 | UserActivityDay、公开角色与礼物汇总 |
| 角色与创作 | lib/characters：公开目录、作者自管、管理编辑/发布、角色任务、评论、素材、互动和共享校验 | Character、图片、任务、评论 |
| 金币与支付 | lib/coins、lib/payments；checkout-policy-service.ts 拥有充值开关、权限与审计，merchant-config-service.ts 为公开状态和下单解析同一商户配置；gifts/read-service.ts 提供礼物榜，send-service.ts 管理赠礼事务 | CoinPackage、PaymentOrder、PaymentCheckoutPolicy、PaymentMerchant、PaymentMerchantRevision、CoinTransaction、Gift |
| 社区与创作者 | circles/service.ts 管理圈子订阅；posts/service.ts 管理帖子/评论事务；creators/read-service.ts 管理创作者资料、动态、关注列表与榜单读取；creators/follow-service.ts 管理关注事务与粉丝计数 | Circle、Post、PostComment、Follow |
| 治理 | community/report-types.ts、report-service.ts、appeal-service.ts、moderation-service.ts、restriction-service.ts | Report、ModerationAction、CommunityAppeal |
| 发现与站点 | lib/discovery/read-service.ts 提供公开世界与星座内容；i18n.ts、sitemap.ts、use-site-content.ts | Banner、Tag、HomeSection、Universe、Horoscope |

## 边界

遵循 [AGENTS.md](AGENTS.md)。路由验证 HTTP 输入、解析身份、调用业务服务并映射响应；规则与写库事务归业务域，组件只负责显示和交互。基础设施保持小而明确，复用现有实现，不制造通用框架。

支付管理组件归 `components/admin/payments`，只调用鉴权管理接口；商城只读取公开套餐接口的充值状态并调用下单接口，不导入管理组件或服务端配置模块。后台调整开关立即对新订单生效，历史订单仍引用原商户版本。更换商城前端时保留这些 HTTP 合约即可，无需迁移后台或复制支付规则。

下单接口的可选 `paymentMethod` 由支付领域校验为 `alipay` 或 `wxpay`，旧客户端省略时默认支付宝；协议层发送必需的 `type`。未签名的平台错误仅用于提示拒绝原因，不作为支付成功、跳转或发币依据；成功响应与到账通知仍须通过RSA验签。

回调先对平台原始参数验签，再用 `parseCnyCents` 将合法十进制金额精确转换为分与订单快照比较，`1`、`1.0`、`1.00` 等价；不改签名原文、不使用浮点数舍入、不接受超精度或科学计数法。到账事务和幂等约束仍由 settlement-service.ts 负责。

AI、对话、角色校验、支付和账户数据导出已按域整理。创作者公开读取与关注事务归 creators 域；API 旧读取入口继续按业务域渐进整理，不把现状描述为全站模块化，也不在无关工作中移动整个目录。

accounts/registration-service.ts owns email/handle normalization, password constraints, duplicate handling and initial account persistence; registration HTTP maps the request, issues the token and sets the media cookie. login-service.ts owns password verification and last-login persistence; session-service.ts increments tokenVersion so logout revokes all issued Bearer and media-session credentials. profile-service.ts owns the explicit self-profile projection, preference validation, unique-handle conflict and profile update. accounts/data-export.ts 在同一读取事务中导出本人数据，显式投影和身份限定保证不展开他人私有角色、举报证据或凭据。导出 v2 包括举报申诉、关系引用、活动奖励、AI 用量和退款状态；HTTP 入口不接受 userId 替换当前身份，个人页仅负责下载。

## AI 与对话

模型可选列表由 AI_MODEL 与 AI_FALLBACK_MODELS 形成白名单。聊天与重生成使用共同的流服务，历史限定当前账号和当前会话。超时、连接和流停滞各有预算；重试只发生在输出前。完整回复需 DONE 或明确 finish_reason，不完整回复不保存，失败重生成保留旧回答。

`conversations/message-service.ts` 统一校验消息和会话归属、用户消息编辑、后续回复清理、消息删除及喜欢时间戳；编辑原消息和清理基于旧内容生成的后续消息在同一数据库事务内完成。发送流程也由它读取限定会话的历史，并在同一事务中保存助手回复、更新会话活动时间和角色消息计数。重生成由服务读取提示与限定历史，并在新答案成功后原子替换旧回复；失败或取消不删除原回复。HTTP 路由只负责认证、解析请求与协调 SSE。

`conversations/conversation-service.ts` owns conversation creation/reuse, character visibility projection, details, owner-only history export, archived/list projections, title/relationship/notes updates and deletion. The create-plus-character-counter change is one transaction; selected AI models are validated against the AI domain's exported catalog. Archived and active chat lists remain explicit filters.

`lib/ai/providers/management-service.ts` 管理供应商连接与权限，`providers/secret.ts` 使用 AES-256-GCM 加密密钥；密钥加密主密钥由服务端 `AI_PROVIDER_ENCRYPTION_KEY` 提供，不返回前端。`lib/ai/models/management-service.ts` 管理逻辑模型键、供应商模型代码、启停、唯一默认模型、备用链、连接超时、重试和输出上限；`models/runtime-service.ts` 为 API 模型目录、会话校验及聊天运行时提供同一投影。只要模型表有配置，数据库路由即作为权威目录；完全未配置时才使用现有环境模型白名单。聊天发送和重生成使用同一模型计划，回退只发生在回复内容输出前。模型目录返回逻辑键与显示名称，不返回供应商密钥。第25条迁移新增供应商，第26条新增模型路由表与独立权限。价格映射和模型成本仍由CM08负责。

`lib/ai/costs/budget-config-service.ts` 是运行时预算配置唯一读取口：未保存数据库预算时兼容 `AI_DAILY_COST_BUDGETS`，首个数据库币种条目建立后由数据库预算表全权接管。`costs/budget-service.ts` 管理原币种的全站/单用户日限额、全局熔断和审计，使用 `ai.costs.read/manage`。`costs/model-price-service.ts` 追加不可变的 `AiModelPrice` 版本，记录模型、币种、来源、生效时间及输入/输出每百万 Token 单价；单价以百万分之一货币单位的整数保存，`AiCall.model_price_id` 固定每次调用采用的价格版本。调用按开始时间取价，历史记录不覆盖；缺少 Token 用量或发生多次尝试仍保持成本未知。预算熔断启用时要求候选模型均有生效价格且每种币种都有对应预算。第28条迁移新增预算与全局策略表；价格历史为本地第40条迁移，尚未部署到仍运行39条迁移的生产环境，真实价格待运营提供。

支付商户由 `lib/payments/merchant-config-service.ts` 管理；`PaymentMerchant` 指向当前配置，`PaymentMerchantRevision` 保存不可变、AES-256-GCM 加密密钥版本，订单外键固定创建时版本。结算与退款以订单版本验证回调、退款及查单，之后轮换不会改变历史订单凭据。旧订单空版本先兼容环境配置；首次后台登记尽可能将已启用环境配置作为加密 legacy 快照保存。正式商户只能有一个启用槽位，由数据库唯一索引约束。第27条迁移不回写旧订单、不删除交易记录。

每日接纳次数按 UTC 日期持久化；并发更新与调用记录在事务内完成，失败/取消也占已接纳次数。上游实际 Token 用量缺失时为 null，估算成本不是供应商账单。SSE 继续使用 content 事件和 [DONE]；模拟输出有显式 demo 标记且限开发环境。

## 角色、社区与治理

公开可见要求 isPublic 且 APPROVED，编辑已公开内容撤销公开并重新审核。管理权限由 admin 领域判断。作者与读者的私有/下架角色权限不同，读者自己的历史仍可查看和导出。

帖子和评论由posts领域验证订阅、作者、可见性、输入限额和站内上传图片；写入使用数据库事务和更新时间版本，删除清除文本与图片但保留目标及举报证据。角色评论与社区评论分开。community仍拥有举报、申诉与禁言；举报的隐藏/恢复在同一事务调用posts状态转换。后台帖子与评论管理分别组合页面，附件预览校验community.read并只读取仍关联的社区素材。第22条迁移新增置顶/推荐和查询索引；领域测试、TypeScript、Next生产构建和13项隔离浏览器检查通过。内容来源登记见 [登记表](docs/content/内容来源登记.md)。

`characters/catalog-service.ts` 负责公开/收藏/我的目录筛选和报告摘要；`characters/creator-service.ts` 负责作者创建、编辑/删除、版权声明和重新提交审核状态；`characters/quest-service.ts` 拥有角色任务授权、配置上限、按已发送消息核验进度和一次性金币奖励事务；`characters/comment-service.ts` 负责角色可见性、评论分页、一级回复、隐藏过滤、频率限制、作者/角色作者删改和点赞计数事务；`characters/engagement-service.ts` 统一角色可见性、点赞计数事务和唯一收藏关系。角色 API 只负责认证、请求解析和 HTTP 错误映射。管理侧角色编辑和发布由 `characters/management-service.ts` 独立授权和维护事务，不复用作者的授权路径。创作者关注/取消关注由 `creators/follow-service.ts` 校验目标、在事务中维护唯一关注关系和粉丝计数；HTTP 路由只处理身份、禁言、限流与响应映射。隔离测试覆盖自关注/不存在用户、重复请求、取消关注和并发幂等。

## 金币与支付

coins/package-service.ts 统一计算活动生效时的赠送金币，供商城和支付域取价；package-management.ts 验证管理配置并在事务中写套餐与修改记录，版本冲突返回 409。default-packages.ts 负责用户确认三档的幂等初始化，保留人工修改。财务 packages API 使用独立财务权限，组件只提交配置，不决定权威价格。旧订单先按幂等键查询，再读取新套餐，因此下架/活动到期不改变旧订单。

coins/reward-ledger.ts 是任务/签到的金币奖励及礼物扣款入口，调用方把它和任务领取/签到/礼物业务放在同一 Prisma 事务；该服务更新余额并在 CoinTransaction.sourceKey 标记奖励来源。growth/reward-budget-service.ts 只读汇总签到、平台任务、角色任务的真实领取笔数与金币发放额；没有运营配置的预算上限时不执行封顶。missions 管理服务配置条件和周期，reward-service 从既有签到、消息、帖子和评论记录计算资格，不能信任客户端进度。checkins 服务读取数据库签到档位并保留原并发 compare-and-swap。支付、退款还由 payments 服务维护带订单/退款引用的专属账本事务，不应为了复用而剥离其幂等键。

签到、任务奖励和礼物扣款在事务内维护余额与流水。EZFP V2 使用 RSA-SHA256；订单从数据库读取人民币价格并快照金额和金币数量，按用户幂等键建单。通知校验签名、商户、状态、金额、订单与平台流水，在同一事务中更新状态、余额与唯一订单流水；重复/并发回调只入账一次。浏览器返回不发币。

财务报告入口为 `/api/finance/report` 和 `/finance`，需要 finance.read 权限，未迁入的环境名单暂作兼容。payments/reconciliation-service.ts 负责订单/流水一致性、负余额和只读事务；ai/cost-report.ts 负责按币种成本汇总，未知成本与模拟调用分别统计。浏览器只展示报告，不写库。

ai/budget-report.ts 在同一只读事务中核对 UTC 当日全站/每账号成本预算，排除模拟调用，保留未知成本和未配置币种提示。预算配置验证及比较归 AI 域；components/admin/finance/ai-budget-report.tsx 只展示。默认仅提示，财务页加载/刷新读取状态；自动熔断由下述调用接纳服务执行，不由 UI 决定，也不自动发送外部通知。

可选自动熔断由 `ai/budget-config.ts` 验证开关/预算、`cost-accounting.ts` 统一单价估算与多次尝试费用完整性、`budget-guard.ts` 在额度写事务内读取对应币种/范围费用。`ai-usage.ts` 先占用本域额度表的写事务，再取 UTC 日期、核对阈值并建立调用；拒绝回滚额度，路由只映射 429/503。完成费用先持久化，再核对并输出结构化告警，监控失败不删除费用记录。默认关闭，不涉及金币结算；在途费用不预留，不能作为精确账单硬上限。看板只显示状态，外部通知仍由部署阶段处理。

payments/validation-metrics.ts 负责同期新注册用户付费率及同期付款订单退款率，使用匹配的分子/分母；同一用户多笔付款只计一个付费用户。ai/cost-report.ts 提供按非模拟调用计算的每千次成本，未知成本时为 null。components/admin/finance/payment-validation-metrics.tsx 负责展示，不决定统计结果或币种换算。无完整成本与渠道费用时不计算毛利率。

整单退款通过 Ezfp V2 refund/query adapter。财务用户提交后在事务中冻结这笔充值的全部金币并创建唯一退款单号；平台签名确认退款完成才把订单设为 REFUNDED。明确拒绝时以一条新的返还流水释放金币；网络/验签状态未知时保持冻结并用原退款单号查单或重试。退款记录、人工操作人、理由及不可变扣币/返还流水单独保留。部分退款暂不提供。

真实商户沙箱仍待验收；独立免费额度和AI对话扣币等待定价，历史期初账务需运营核对。渠道账单导入与差异核对已实现，实际账单格式、手续费和结算仍待真实渠道验收。保留旧 THB 字段，不自动换算人民币。付费路径与定价边界见 [README](README.md)。

## 持久化与扩展限制

账号注销由 accounts/closure-service.ts 拥有事务，验证本人密码并占用写事务后，调用 conversations/characters/community 隐私服务清除所属内容；保留匿名账务和举报审计。deletedAt、凭据版本和数据库约束防止复活。uploads 的 storage/privacy/read 服务分别管理归属、清理和可见性，路由只认证/映射。auth-cookies.ts 仅为图片 GET 提供 HttpOnly 身份，写 API 保持 Bearer。日志保留路由/错误类型/安全代码，不输出原始消息、堆栈或 Prisma 参数。

运维备份/恢复基础设施在 `lib/operations/sqlite-backup.mjs`，脚本 `backup-db.mjs` 与 `restore-db.mjs` 只解析参数和展示检查结果。备份使用 VACUUM INTO，检查取自快照；恢复仅创建新文件并复验，不替业务域改账、不切换服务、不修改模型或支付配置。上传文件与密钥独立保存。

联合备份编排在 `operations/state-backup.mjs`，复用 SQLite 快照并调用上传域的 `backup-references.mjs` 获取持久引用。上传路径统一由 `uploads/storage-location.mjs` 解析，保存、读取、帖子附件校验和注销清理共享该位置；默认 `public/uploads`，可通过服务端 `UPLOADS_DIRECTORY` 指向恢复文件。`backup-state.mjs` / `restore-state.mjs` 仅处理命令行输入和结果。停写后备份数据库与上传，密钥独立保管，不替业务域更改余额或支付状态。

当前 SQLite 使用 WAL 与 busy_timeout，迁移不能删除或折叠历史。分钟限流在单进程 Map 中，多实例前须替换共享存储；SQLite 部署需持久化数据库与用户上传，不直接改 provider 就宣称完成 PostgreSQL 迁移。

## 源码与交付目录

src按页面、展示组件及业务领域分工；prisma保存模型与完整有序迁移，deploy保存脱敏运维配置，scripts和tests保存仍在使用的运维及隔离验证入口。docs只维护业务规则、实施范围和内容来源。数据库、上传、备份、环境配置不进入源码归档。node_modules、.next、.next-build与artifacts为依赖或生成资料，按用途清理，不以删除目录代替业务核查。开发工具配置与AGENTS仅影响维护，不属于产品权限。

## 设计令牌与完成定义

颜色只走令牌：`globals.css` 的 `:root` 定义 `--brand`、`--brand-2`、`--brand-strong`、`--brand-accent-1/2`、`--brand-gradient`、`--brand-gradient-accent`，`tailwind.config.ts` 把它们映射成 `brand`、`brand-strong`、`brand-gradient-accent` 等类。组件里不写十六进制品牌色；服务端默认值集中在 `lib/site-content/brand-defaults.ts`，与令牌保持同值。

`npm run verify:done` 把计划书第 7 章的完成定义做成可执行检查：品牌色字面量、旧字体类名、词典外泰语、`zhText` 残留、旧管理前缀、兼容重写、前后台隔离、khui 命名，逐条输出 ok/FAIL。白名单写在脚本里并注明理由，新增例外必须同时改脚本，不能靠人肉判断。

## 管理接口的路由边界

管理接口全部位于 `/api/admin/**`。A3 的兼容窗口已结束：`next.config.mjs` 不再重写旧前缀，`/finance`、`/moderation` 页面跳转也已删除，`maintenance-routing.ts` 的免拦截白名单只剩 `/api/admin`。旧前缀现在与未知路径一样返回 404，维护模式下与普通业务写一样被 503 拦下。

## 前端接口合同

`lib/api-paths.ts` 是前端可见接口路径的唯一来源，参数一律 `encodeURIComponent`；组件不再拼 `/api/...` 字面量，改路径只改这一处。`lib/api-client.ts` 是浏览器侧唯一的 HTTP 入口：拼 `Authorization: Bearer`、序列化 body、把非 2xx 统一抛成带 `status`/`code`/`body` 的 `ApiError`。`lib/api-types/` 按域存放响应类型，只声明前端真正读到的字段。

服务端有两套错误体：迁移到 `lib/http` 的 30 个管理路由返回 `{error, code}`，其余 93 个旧路由只有 `{error}`。因此客户端的 `code` 是可选值，缺失时按 `lib/http/status-codes.ts` 用状态码兜底，两侧共用同一张映射表。404 可能返回 HTML，解析失败不能盖住真实状态码。

`apiFetch` 解析 JSON，`apiBlob` 用于导出，`apiRaw` 用于 SSE 和需要读响应头的场景（如商城 `X-Checkout-Enabled`）。`AbortError` 原样抛出，否则组件里的 `signal.aborted` 判断会失效。服务端只认 Bearer，不信 cookie，客户端不发 `credentials: 'include'`。

## 管理权限

lib/admin拥有角色、权限、管理身份及审计事务。数据库管理身份优先于兼容的环境名单，所有者由服务器命令显式初始化到已注册账号。系统角色固定，自定义角色可以撤销全部权限；操作权限必须包含所属领域的查看权限。后台页面位于app/admin，复用审核和财务页面；展示组件按admin/finance和admin/moderation分组。停用身份撤销已有会话，最后所有者不可降权、停用或注销。

## 站点内容管理

`lib/site-content/` owns validated content types, draft/publish/schedule transitions, revision snapshots and the public published-content projection. Admin API routes authenticate and map HTTP input; components under `admin/site-content` edit content without writing to the database. The public pages and shell consume the projection through `/api/site` or the read service. Page bodies use an explicit block allowlist (`PARAGRAPH`, `HEADING`, `LINK`, `NOTICE`, `BUTTON`, `CARD_GRID`, `IMAGE`, `LIST`); arbitrary HTML and script execution are not supported. Migration history 23–24 adds content workflow, navigation, page and branding tables while preserving the existing banner, tag, badge and home-section rows.

## 用户管理

accounts/management-service.ts拥有查询投影、分页、账号停用/恢复、会话撤销及乐观版本事务；login-service.ts处理密码登录和登录时间。User中的suspendedAt与社区禁言、注销分别管理，停用递增tokenVersion，认证及私有媒体读取拒绝旧会话；恢复不复活旧令牌。最后有效所有者及管理账号会话由admin服务保护。

community/report-service.ts拥有举报类别校验、目标归属/存在检查、证据快照、速率限制和举报去重事务；report-types.ts是 API 和报告表单共享的类型目录。community/restriction-service.ts维护禁言状态与accountVersion，用户后台、举报和申诉共同调用；community/moderation-service.ts拥有举报/申诉的状态转换、处置及审核审计；community/appeal-service.ts拥有用户申诉资格、去重、写入与提交审计事务。相关HTTP路由不再直接写用户封禁字段、申诉表或举报表。后台accounts展示按列表、详情和页面组合分开；只展示角色/订单摘要，金币流水需要财务查看权限，不读取私有对话或人设。

角色审核由characters/review-service拥有事务，单条及批量HTTP入口调用同一服务；事务内重新校验审核能力，按最新版权、公开申请状态及更新版本执行，审计只保存状态与版本，不保存私有人设。批量审核展示在admin/moderation/bulk-character-review，数据检查与公开决定由服务器负责。

角色后台由characters/management-service拥有列表、内容与发布事务，managed-assets维护相关素材/配角记录且保留ID。编辑与发布能力分离，内容保存不直接公开；私有预览经characters.read并限定关联素材，不能访问其他聊天图片。列表、编辑、素材编辑、批量操作分布在components/admin/characters，HTTP入口位于api/characters/management。

## 圈子与成员管理

circles/content共享内容及世界观校验，service拥有公开查询、创建和订阅事务；management-service拥有管理查询、内容、公开与推荐事务，membership-management拥有成员移除及加入限制。操作事务重新授权，使用圈子更新版本或成员记录时间拒绝过期覆盖。站点圈子ownerId为空，个人作者圈子保留原归属；公开列表按推荐排序，详情独立按编号读取。加入限制与订阅记录分开，限制会移除订阅并阻止重新加入，解除限制不替用户订阅。注销清理和个人导出由各领域提供明确记录，不复制后台规则。

HTTP入口在api/circles及api/circles/management；后台组合、内容编辑和成员管理分布在components/admin/circles，公开圈子展示在components/circles。第21条迁移保留原圈子/成员/帖子关系和注销触发器，新增圈子推荐、站点归属及成员限制。旧版本不识别空owner和成员限制，启用这些业务后回退需保留兼容服务或执行停写后的受控恢复，不能直接切换到旧20迁移应用并假定行为兼容。
