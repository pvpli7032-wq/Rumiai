# 当前架构与维护边界

HTTP 入口在 src/app/api，页面在 src/app，交互组件在 src/components，模型与有序迁移在 prisma。采用 Next.js App Router；route.ts、page.tsx、middleware 与动态 sitemap 是框架入口，无普通 import 也可能正在使用。

| 域 | 实现 | 数据 |
|---|---|---|
| 认证与账户 | lib/auth.ts、auth-context.tsx、user-identity.ts、accounts/data-export.ts | User、tokenVersion |
| AI | lib/ai：配置、模型白名单、额度与用量 | AiCall、AiDailyUsage |
| 对话 | lib/conversations：提示词、模型流、SSE、列表事件 | Conversation、Message |
| 角色与创作 | lib/characters/validation.ts、creator 组件与角色 API | Character、图片、任务、评论 |
| 金币与支付 | lib/coins、lib/payments | CoinPackage、PaymentOrder、CoinTransaction |
| 社区 | circles/service.ts 拥有圈子创建/查询/成员订阅；community-posts.ts 与帖子/关注 API | Circle、Post、PostComment、Follow |
| 治理 | reports.ts、community-moderation.ts、moderator.ts | Report、ModerationAction、CommunityAppeal |
| 发现与站点 | i18n.ts、sitemap.ts、use-site-content.ts | Banner、Tag、HomeSection、Universe |

## 边界

遵循 [AGENTS.md](AGENTS.md)。路由验证 HTTP 输入、解析身份、调用业务服务并映射响应；规则与写库事务归业务域，组件只负责显示和交互。基础设施保持小而明确，复用现有实现，不制造通用框架。

AI、对话、角色校验、支付和账户数据导出已按域整理；社区、治理与账户其他流程仍有平铺服务，部分路由仍直接使用 Prisma。后续按实际业务改动渐进整理，不把现状描述为全站模块化，也不在无关工作中移动整个目录。

accounts/data-export.ts 在同一读取事务中导出本人数据，显式投影和身份限定保证不展开他人私有角色、举报证据或凭据。导出 v2 包括举报申诉、关系引用、活动奖励、AI 用量和退款状态；HTTP 入口不接受 userId 替换当前身份，个人页仅负责下载。

## AI 与对话

模型可选列表由 AI_MODEL 与 AI_FALLBACK_MODELS 形成白名单。聊天与重生成使用共同的流服务，历史限定当前账号和当前会话。超时、连接和流停滞各有预算；重试只发生在输出前。完整回复需 DONE 或明确 finish_reason，不完整回复不保存，失败重生成保留旧回答。

每日接纳次数按 UTC 日期持久化；并发更新与调用记录在事务内完成，失败/取消也占已接纳次数。上游实际 Token 用量缺失时为 null，估算成本不是供应商账单。SSE 继续使用 content 事件和 [DONE]；模拟输出有显式 demo 标记且限开发环境。

## 角色、社区与治理

公开可见要求 isPublic 且 APPROVED，编辑已公开内容撤销公开并重新审核。管理权限由 admin 领域判断。作者与读者的私有/下架角色权限不同，读者自己的历史仍可查看和导出。

帖子和评论验证订阅、作者、可见性、输入限额和站内上传图片；角色评论与社区评论分开。举报保存服务端读取的证据，目标删除不会删除举报证据。人工处置、申诉与审计保留业务边界。内容来源登记见 [登记表](docs/content/内容来源登记.md)。

## 金币与支付

coins/package-service.ts 统一计算活动生效时的赠送金币，供商城和支付域取价；package-management.ts 验证管理配置并在事务中写套餐与修改记录，版本冲突返回 409。default-packages.ts 负责用户确认三档的幂等初始化，保留人工修改。财务 packages API 使用独立财务权限，组件只提交配置，不决定权威价格。旧订单先按幂等键查询，再读取新套餐，因此下架/活动到期不改变旧订单。

签到、任务奖励和礼物扣款在事务内维护余额与流水。EZFP V2 使用 RSA-SHA256；订单从数据库读取人民币价格并快照金额和金币数量，按用户幂等键建单。通知校验签名、商户、状态、金额、订单与平台流水，在同一事务中更新状态、余额与唯一订单流水；重复/并发回调只入账一次。浏览器返回不发币。

财务报告入口为 `/api/finance/report` 和 `/finance`，需要 finance.read 权限，未迁入的环境名单暂作兼容。payments/reconciliation-service.ts 负责订单/流水一致性、负余额和只读事务；ai/cost-report.ts 负责按币种成本汇总，未知成本与模拟调用分别统计。浏览器只展示报告，不写库。

ai/budget-report.ts 在同一只读事务中核对 UTC 当日全站/每账号成本预算，排除模拟调用，保留未知成本和未配置币种提示。预算配置验证及比较归 AI 域；components/admin/finance/ai-budget-report.tsx 只展示。默认仅提示，财务页加载/刷新读取状态；自动熔断由下述调用接纳服务执行，不由 UI 决定，也不自动发送外部通知。

可选自动熔断由 `ai/budget-config.ts` 验证开关/预算、`cost-accounting.ts` 统一单价估算与多次尝试费用完整性、`budget-guard.ts` 在额度写事务内读取对应币种/范围费用。`ai-usage.ts` 先占用本域额度表的写事务，再取 UTC 日期、核对阈值并建立调用；拒绝回滚额度，路由只映射 429/503。完成费用先持久化，再核对并输出结构化告警，监控失败不删除费用记录。默认关闭，不涉及金币结算；在途费用不预留，不能作为精确账单硬上限。看板只显示状态，外部通知仍由部署阶段处理。

payments/validation-metrics.ts 负责同期新注册用户付费率及同期付款订单退款率，使用匹配的分子/分母；同一用户多笔付款只计一个付费用户。ai/cost-report.ts 提供按非模拟调用计算的每千次成本，未知成本时为 null。components/admin/finance/payment-validation-metrics.tsx 负责展示，不决定统计结果或币种换算。无完整成本与渠道费用时不计算毛利率。

整单退款通过 Ezfp V2 refund/query adapter。财务用户提交后在事务中冻结这笔充值的全部金币并创建唯一退款单号；平台签名确认退款完成才把订单设为 REFUNDED。明确拒绝时以一条新的返还流水释放金币；网络/验签状态未知时保持冻结并用原退款单号查单或重试。退款记录、人工操作人、理由及不可变扣币/返还流水单独保留。部分退款暂不提供。

真实商户沙箱仍待验收；独立免费额度、AI 对话扣币、历史期初流水和支付渠道账单对账仍待实现。保留旧 THB 字段，不自动换算人民币。付费路径与定价边界见 [README](README.md)。

## 持久化与扩展限制

账号注销由 accounts/closure-service.ts 拥有事务，验证本人密码并占用写事务后，调用 conversations/characters/community 隐私服务清除所属内容；保留匿名账务和举报审计。deletedAt、凭据版本和数据库约束防止复活。uploads 的 storage/privacy/read 服务分别管理归属、清理和可见性，路由只认证/映射。auth-cookies.ts 仅为图片 GET 提供 HttpOnly 身份，写 API 保持 Bearer。日志保留路由/错误类型/安全代码，不输出原始消息、堆栈或 Prisma 参数。

运维备份/恢复基础设施在 `lib/operations/sqlite-backup.mjs`，脚本 `backup-db.mjs` 与 `restore-db.mjs` 只解析参数和展示检查结果。备份使用 VACUUM INTO，检查取自快照；恢复仅创建新文件并复验，不替业务域改账、不切换服务、不修改模型或支付配置。上传文件与密钥独立保存。

联合备份编排在 `operations/state-backup.mjs`，复用 SQLite 快照并调用上传域的 `backup-references.mjs` 获取持久引用。上传路径统一由 `uploads/storage-location.mjs` 解析，保存、读取、帖子附件校验和注销清理共享该位置；默认 `public/uploads`，可通过服务端 `UPLOADS_DIRECTORY` 指向恢复文件。`backup-state.mjs` / `restore-state.mjs` 仅处理命令行输入和结果。停写后备份数据库与上传，密钥独立保管，不替业务域更改余额或支付状态。

当前 SQLite 使用 WAL 与 busy_timeout，迁移不能删除或折叠历史。分钟限流在单进程 Map 中，多实例前须替换共享存储；SQLite 部署需持久化数据库与用户上传，不直接改 provider 就宣称完成 PostgreSQL 迁移。

## 源码与交付目录

src按页面、展示组件及业务领域分工；prisma保存模型与完整有序迁移，deploy保存脱敏运维配置，scripts和tests保存仍在使用的运维及隔离验证入口。docs只维护业务规则、实施范围和内容来源。数据库、上传、备份、环境配置不进入源码归档。node_modules、.next、.next-build与artifacts为依赖或生成资料，按用途清理，不以删除目录代替业务核查。开发工具配置与AGENTS仅影响维护，不属于产品权限。

## 管理权限

lib/admin拥有角色、权限、管理身份及审计事务。数据库管理身份优先于兼容的环境名单，所有者由服务器命令显式初始化到已注册账号。系统角色固定，自定义角色可以撤销全部权限；操作权限必须包含所属领域的查看权限。后台页面位于app/admin，复用审核和财务页面；展示组件按admin/finance和admin/moderation分组。停用身份撤销已有会话，最后所有者不可降权、停用或注销。

## 用户管理

accounts/management-service.ts拥有查询投影、分页、账号停用/恢复、会话撤销及乐观版本事务；login-service.ts处理密码登录和登录时间。User中的suspendedAt与社区禁言、注销分别管理，停用递增tokenVersion，认证及私有媒体读取拒绝旧会话；恢复不复活旧令牌。最后有效所有者及管理账号会话由admin服务保护。

community/restriction-service.ts维护禁言状态与accountVersion，用户后台、举报和申诉共同调用；community/moderation-service.ts拥有举报/申诉的状态转换、处置及审核审计。相关HTTP路由不再直接写用户封禁字段。后台accounts展示按列表、详情和页面组合分开；只展示角色/订单摘要，金币流水需要财务查看权限，不读取私有对话或人设。

角色审核由characters/review-service拥有事务，单条及批量HTTP入口调用同一服务；事务内重新校验审核能力，按最新版权、公开申请状态及更新版本执行，审计只保存状态与版本，不保存私有人设。批量审核展示在admin/moderation/bulk-character-review，数据检查与公开决定由服务器负责。

角色后台由characters/management-service拥有列表、内容与发布事务，managed-assets维护相关素材/配角记录且保留ID。编辑与发布能力分离，内容保存不直接公开；私有预览经characters.read并限定关联素材，不能访问其他聊天图片。列表、编辑、素材编辑、批量操作分布在components/admin/characters，HTTP入口位于api/characters/management。
