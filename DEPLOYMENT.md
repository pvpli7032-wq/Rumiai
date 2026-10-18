# 本机运行与运维

宝塔目标域名为 `lh.y-98.cn`，当前发布为 `payment-amount-20261017`，已应用45条迁移。2026-10-17恢复SSH后，现场确认此前实际运行的是Khui39迁移版本；旧Toonflow活动进程的早期快照已被本次核实取代。本次升级继续使用原shared数据库与上传，不改用空库或Toonflow库。

2026-10-17 真实回调金额格式修复：平台回调 money=1 通过签名但被原字符串比较误拒，现先验证原始签名，再按整数分精确比较，支持1/1.0/1.00。16项隔离支付检查、类型检查及116页生产构建通过，生产数据库无迁移。用户已付款订单经新鲜签名查单核对商户、平台单号、本地单号、金额及已支付状态后，仅重放原真实签名通知，返回success；该订单PAID，10金币、唯一一条PURCHASE流水，无新增扣款。历史拒绝记录保留；到账幂等事务及未支付订单不变。新版本进程和健康检查通过，原payment-protocol-20261017保留作应用恢复。

2026-10-17 支付协议修复：按官方文档及PHP SDK补齐下单 `type`（支付宝/微信），旧客户端默认支付宝；商户未签名的非成功响应只展示拒绝原因，不作为支付状态依据。成功响应仍须RSA验签，省略sign_type时按平台默认RSA校验，显式非RSA拒绝；到账通知仍保留独立的签名、时间戳与幂等检查。14项本地模拟支付检查、类型检查和116页Linux构建通过，线上支付方式选择、1元按钮及READY状态验收通过。单次构建因隔离SQLite并发超时失败后，仅在准备目录临时使用单构建worker完成，源配置已恢复。无生产迁移、无真实下单重试或扣款；原待核对订单未修改。此前平台只读查单返回最近一笔订单不存在，真实付款与到账仍待用户验证。

2026-10-17 充值接入修复：新增 `PaymentCheckoutPolicy`，后台「支付商户」顶部可保存充值总开关；权限沿用支付商户管理权限，写入带版本检查及审计。未保存时继承旧 `EZFP_ENABLED`；保存后以数据库策略为准，无需复制商户密钥到环境变量。公开套餐接口保留数组结构和 `X-Checkout-Enabled`，新增 `X-Checkout-Reason`；状态检查和新订单统一读取支付领域配置。关闭仅阻止新订单，历史通知仍使用原配置版本。7项隔离支付/升级检查及116页Linux构建通过，线上后台入口、关闭提示及健康检查通过。用户明确授权后已通过后台开启生产充值（策略版本1），线上返回 READY，1元10金币及其他支付按钮已可用；未创建真实订单或扣款，实际付款与到账尚未验收。发布前联合备份仅保留服务器 `checkout-policy-20261017/prisma/backups/database-before-checkout-policy`；应用恢复目录 `checkout-policy-20261017-fallback` 含45迁移清单及旧支付界面，可兼容新增表；不可直接启动只有44迁移的旧目录。监控工作目录已同步切换，定时器恢复。

2026-10-17 支付密钥兼容修复：保存、签名和验签统一支持完整 PEM、文字换行及无头尾的 Base64（私钥 PKCS8/PKCS1，公钥 SPKI/PKCS1），保存前规范化并加密。保留至少2048位RSA要求，分别提示商户私钥、平台公钥错误，并补充表单说明。14项隔离支付检查、Linux生产构建116页通过；本次无数据库迁移，原 `commercial-20261017-admin44` 保留供应用回退，shared配置、数据库和上传继续沿用，未请求真实支付。

当前项目使用 SQLite 和本机文件上传，先完成隔离验证再评估部署。密钥只放在不提交的本地环境文件，不放进源码或日志。数据库、上传和密钥都是持久数据，删除缓存不能连带删除这些内容。

## 2026-10-17 发布验收

2026-10-17 已恢复SSH并现场确认原活动服务为 Khui `commercial-20261014-1250`，沿用 shared 数据库、上传和环境文件，未使用 Toonflow 数据。现已发布 `commercial-20261017-admin44`，Node24.14.1 / Rocky Linux9.2、44条迁移、116页Linux构建；迁移前后66张原业务表的原字段记录保持，5个用户、6个角色保留，完整性和外键检查通过。服务器内联合备份为新发布目录下 `prisma/backups/database-before-admin44-stage` 与 `database-before-admin44-cutover`；环境配置独立备份，仅留服务器。

源码ZIP仅含642个源码/静态/配置文件，SHA256为 `15ac2253a9175d0d8e6dddc4f0f130290dc83bae7b2404b08cbe5180b52fc1f4`，不包含密钥、数据库、依赖或用户上传。Linux专项24项、生产副本原记录核对、11接口和维护写入通过。副本关闭时清理遇到ESRCH，已只读确认备用端口关闭，没有将该清理异常当成后台功能失败或重复启动依据。

PM2的startOrReload未更新旧工作目录，目录断言拒绝该状态并恢复旧代码；随后仅重建独立PM2中的khui-ai条目，确认新工作目录及健康后保存进程列表。生产迁移已经成功，过程中未回退或覆盖数据库。公网原admin账号登录、9接口、7页面桌面/手机14项和支付关闭检查通过，截图结果见 `artifacts/live-admin44/1792179555871/`。

原环境缺少两项加密主密钥且供应商/商户表为空，已分别生成64位十六进制密钥并保存于受保护的shared/app.env，原JWT与其他配置保留。旧环境备份为 `shared/app.env.before-commercial-20261017-admin44`，包含新主密钥的切换备份为 `shared/app.env.before-admin44-cutover`，均600权限，仅留服务器。

健康单元已渲染到当前发布路径，systemd校验、Result=success、ExecMainStatus=0通过，五分钟timer保持active。其旧单元保存在 `shared/khui-ai-health.service.before-admin44`；后台正式证书检查已保存VALID/verified=true，有效至2027-01-11T04:51:56Z；该观察不等于续签。新健康路径已于2026-10-17 03:44:14（服务器CST）实际自动触发并记录site_health_ok；证书续签和完整应用/数据/上传/密钥联合回滚仍单独验收。最终清理已验证两份联合备份并删除不再使用的预演副本，生产数据保留。以下带日期章节为历史记录，不代表当前活动目录。

## 初始化与迁移

安装依赖使用 npm ci，随后 npm run db:init；该命令创建缺失的 SQLite 文件、应用有序迁移、生成 Prisma client 并初始化原创内容，不重置已有数据。DATABASE_URL=file:./dev.db 指向 prisma/dev.db。已有库变更前先备份，使用 migrate deploy，不使用 db push/reset 代替版本迁移。

`npm run db:backup -- <标签>` 从 DATABASE_URL 读取源库，用 VACUUM INTO 生成包含已提交 WAL 的一致性备份，保存到 `prisma/backups/<源库名>-<标签>.db`。标签仅支持字母、数字、下划线、连字符，省略时使用时间戳。备份完成后检查快照本身的完整性、外键、迁移状态及各表计数，不从运行中的源库取计数。重名文件不会覆盖。备份含账户和聊天私密数据，须限制访问并另行保存到受保护的异地位置。

恢复只能写入全新文件，不覆盖数据库或其 WAL/SHM/journal 附属文件，也不自动切换运行服务：

```powershell
$env:DATABASE_URL = 'file:./m4-03-validation.db'
npm run db:backup -- before-release
npm run db:restore -- "prisma/backups/m4-03-validation-before-release.db" "prisma/restored-before-release.db"
npm run test:m5:backup
```

恢复前检查备份，复制后再次检查完整性与各表计数；源文件损坏、缺失迁移历史或有未完成迁移时失败。恢复源须为单文件快照，不能拿仍有附属文件的运行库代替。`db:backup` / `db:restore` 只处理数据库，联合恢复使用下述命令。

联合备份前停止所有业务写入和上传清理任务；工具不会自动停服，数据库与文件不具备跨资源原子快照保证：

```powershell
npm run state:backup -- before-release
npm run state:restore -- "prisma/backups/dev-before-release" "prisma/restores/before-release"
$env:DATABASE_URL = 'file:C:/Users/42422/Desktop/ai-role-community/prisma/restores/before-release/database.db'
$env:UPLOADS_DIRECTORY = 'C:/Users/42422/Desktop/ai-role-community/prisma/restores/before-release/uploads'
npm run test:m5:state-backup
```

示例路径须换成实际部署路径。恢复只创建全新目录，检查数据库、持久引用和上传文件大小/SHA256；默认上传位置为 `public/uploads`。同时切换数据库与上传配置，人工更换随机 JWT 密钥后再启动，避免恢复旧凭据后旧令牌重新有效；脚本不会自动修改 `.env`。恢复成功后在新目标写 `restore-result.json`，记录完成时间、源清单时间/数据库指纹和操作时的校验结果，源库与源备份保持不变。恢复后继续业务写入不会改写这份历史记录，也不能再把运行中的目录作为未改变的快照。来源须可信，敏感备份限制访问并保护异地副本；环境密钥、部署配置独立保管，脚本不复制根目录 `.env`。失败的部分目标保留检查，重试用新标签/新目录。

`/admin/operations` 的只读记录表按文件修改时间分页读取 `prisma/backups`，区分单文件、联合备份、隔离恢复、缺失文件和异常清单。数据库采用标准恢复布局 `.../database.db` 时，也显示其所在目录的恢复结果。API只返回时间、体积、数量和状态，不返回目录、备份名称、上传文件名或业务内容。读取清单不会重新哈希数据，也不代表实际服务切换/回滚通过；超过8 MiB的清单显示超限，使用CLI核验。恢复结果只是一份受保护的操作记录，不是可随意清理的调试日志。

服务切换步骤：停止当前实例和后台写入 → 另存当前数据库与上传 → 从版本匹配的联合备份恢复到全新目录 → 设置 DATABASE_URL 与 UPLOADS_DIRECTORY → 运行发布迁移兼容检查 → 在隔离实例核对登录、角色、内容与财务 → 核验后切换进程并恢复访问。启动门禁要求目标代码迁移目录与数据库迁移记录完全一致；旧代码不能直接连接较新数据库。`commercial-20261017-admin44`发布前备份`database-before-admin44-cutover`为39迁移，旧`commercial-20261014-1250`代码配此恢复库已在服务器隔离启动，公开接口200、匿名管理接口401；同一旧代码配44迁移库被门禁拒绝，且旧CMS读不到新PAGE图片。当前数据库相较该39迁移备份，有4张共同表行数变化（admin_roles、admin_role_permissions、admin_audit_logs、user_activity_days）；回滚前须另存当前状态并人工核对这些新增或变化的运维记录，行数相同也不证明记录未更新。上传、加密主密钥与数据库必须匹配切换；真实AI和支付保持关闭，直至相应版本完成隔离验收。脚本不自动停服、改.env、覆盖旧库或执行数据合并。

## 18781 隔离服务

在项目目录的同一个 PowerShell 进程执行：

```powershell
$env:DATABASE_URL = 'file:./m4-03-validation.db'
$env:JWT_SECRET = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$env:OPENAI_API_KEY = ''
$env:DISABLE_MOCK_AI = 'true'
$env:ALLOW_SIMULATED_PURCHASES = 'false'
$env:EZFP_ENABLED = 'false'
$env:NEXT_PUBLIC_SITE_URL = 'http://127.0.0.1:18781'
# 仅在隔离库首次初始化或确实需要迁移时运行：
npm run db:init
npm run build
npm start -- --hostname 127.0.0.1 --port 18781
```

商城为 http://127.0.0.1:18781/shop。隔离环境无真实模型调用或扣款。正常 npm build/start 使用 .next-build；直接 node node_modules/next/dist/bin/next start 时显式设置 NEXT_DIST_DIR=.next-build，否则会查错目录。

浏览器检查在第二个窗口运行：

```powershell
npx playwright install chromium
$env:TEST_BASE_URL = 'http://127.0.0.1:18781'
npm run test:m4:ezfp:browser
```

本机若将浏览器安装在自定义目录，安装和验收同时设置 PLAYWRIGHT_BROWSERS_PATH。HTTP 200 不等于真实支付验收；上述检查只覆盖商城和套餐、按钮配置、390px 布局以及页面错误。

## 账号数据导出

已登录用户可在 `/profile` 的“我的数据”区域请求 `/api/users/me/export`，导出本人资料、聊天、角色、社区、举报及账务记录。身份由服务端认证限定，响应私有且不缓存，不导出凭据或他人私有数据。

导出 JSON v2 补充本人举报/申诉、关注与粉丝关系 ID、圈子/订阅、收藏点赞、签到礼物、任务进度、AI 用量及本人订单退款状态。关系仅包含引用 ID，不展开其他账号资料或私有人设；举报不导出证据快照。`npm run test:m5:export` 使用一次性隔离库。浏览器下载检查需要 `TEST_BASE_URL` 指向隔离本机实例、`TEST_ISOLATED_DB=true`，运行 `npm run test:m5:export:browser`；它会创建测试账号，并在 artifacts/account-export 保存合成数据 JSON，不应运行在用户体验库。

## 账号注销与上传文件

个人页注销要求当前密码、输入“注销我的账号”及确认保留说明。操作匿名化身份并使旧凭据失效，清除本人聊天/角色/社区内容及偏好，移除关注点赞收藏。其他用户的聊天/回复保留；圈子保持可用但创建者文本清除。订单、金币余额/流水、AI成本和举报/审核记录保留，不扣回余额。请在注销前处理所需退款；未结束支付/退款或 AI 请求会阻止注销。

迁移 `20261013020000_account_closure` 新增 deletedAt、注销记录和上传归属，写约束防止注销后的迟到内容写入；迁移本身不注销账号。已有库先备份再 migrate deploy。回滚应用不能恢复已清除资料，不应通过旧版重新激活匿名账号。

新上传记录归属，注销清理已确认属于本人的文件；旧无归属且仍有引用的共享文件留待核查。`npm run ops:closure-files` 重试已确认注销的待清理记录，只输出计数，不强制删除仍被引用的旧共享文件。运营方另行处理备份、供应商数据及实际保留期限。

`/uploads/<名称>` 由业务接口动态读取，解决生产服务启动后新图片 404。私有素材限本人 Bearer/HttpOnly 媒体 Cookie；公开引用限审核角色或可见帖子等，引用他人私有上传不会将其公开。已注销账号的已归属文件拒绝读取，响应不缓存，私有路径被 image optimizer 拒绝。媒体 Cookie 在注册/登录写入，注销/退出清除；不为写 API 授予 Cookie 身份。旧浏览器升级后重新登录，HTTPS 部署配置真实站点 URL。

`test:m5:closure` 用一次性隔离库和合成图片；`test:m5:closure:browser` 要求 TEST_BASE_URL 及 TEST_ISOLATED_DB=true，仅在隔离服务运行，会创建并注销脚本自己的账号。

## 服务端配置

套餐后台位于 `/finance`，使用 PAYMENT_ADMIN_USER_IDS；支持人民币价格（后台按元输入，服务端按整数分）、基础/赠送金币、排序、上架及活动时间。不填开始/结束为持续赠送；定时活动需同时填写两项，时间按设备时区输入并以 UTC 保存，结束时刻不再赠送。保存保留操作人及前后记录；并发编辑版本冲突需要刷新后再编辑。

新版本新增迁移 `20261013010000_coin_package_management`。已有数据库先备份，再 `prisma migrate deploy`；初始化默认套餐使用 `npm run db:seed:site`（或完整 `db:init`）。这会创建 ¥6/60、¥10/100、¥30/300 三档，并下架原未配人民币价格的种子套餐；不改用户余额、旧订单或后续人工编辑。已配置人民币价的旧套餐由管理员自行决定上下架。新建人民币套餐的历史 THB 字段用 0 占位，不参与支付或换汇。支付开关仍默认关闭。

回滚应用时保留新增列和修改记录，暂停套餐编辑；不删除订单/余额或 reset 数据库。旧订单的幂等重试使用已存快照。用户看到的报价与当前配置不一致时，商城要求刷新并再次确认，不静默按新报价下单。

参考 .env.example。JWT_SECRET 至少 32 字符且随机；当数据库尚未配置模型路由时，OPENAI_BASE_URL、AI_MODEL 与备用模型构成兼容环境路由；登记数据库模型后，启用模型及其默认/备用顺序成为聊天路由权威配置。后台 AI 供应商配置使用 `AI_PROVIDER_ENCRYPTION_KEY`（64 位十六进制、32 字节）以 AES-256-GCM 加密 SQLite 中的密钥；该值必须纳入受保护备份并保持稳定，否则已保存的供应商密钥无法解密。AI_CONNECT_TIMEOUT_MS、AI_REQUEST_TIMEOUT_MS、AI_STREAM_IDLE_TIMEOUT_MS 与 AI_MAX_RETRIES 控制环境模型请求预算；数据库模型可分别配置连接超时、重试和输出上限。CHAT_DAILY_LIMIT 是调用上限而非独立免费商品额度。

MODERATOR_USER_IDS 是审核用户 ID 白名单。AI 输入/输出单价未知时保持空值；币种和 AI_PRICE_MODEL 必须对应确认的单价。

商户后台位于 `/admin/payments/merchants`，使用独立 `payments.merchants.*` 权限。`PAYMENT_MERCHANT_ENCRYPTION_KEY` 应为随机 32 字节（64 位十六进制），保存在受保护服务器环境并纳入受限备份，不得提交代码；密钥更换前必须完成数据库中所有商户修订的安全重加密。订单固定创建时商户修订，回调及退款按订单修订读取凭据。旧订单修订为空时兼容原 EZFP 环境配置；首次后台登记时，如果环境凭据与独立加密主密钥齐全，会在同一事务加密快照旧配置，页面提示快照结果；否则旧订单仍依赖服务器旧环境密钥，待旧订单结清前不可轮换或删除。商户目录存在后新订单只用启用的正式商户，不回退环境凭据。`EZFP_ENABLED` 与 `EZFP_REFUNDS_ENABLED` 保留为服务器总开关，退款还需该订单修订单独允许。后台本地验证只检查 RSA 密钥格式，不代表渠道账号已连通或通过真实商户验收。

PAYMENT_ADMIN_USER_IDS 是独立的财务用户 ID 白名单，默认不授予任何人权限，不继承内容审核角色。登录该账号后访问 `/finance`；报告按 1/7/30/90 天汇总本地订单金额、已完成退款及各币种 AI 成本，对所有留存订单核对充值/退款流水并列出负余额。它不核实渠道账单，也不会自动纠正账本。未知模型成本不记作零，历史期初余额未登记前不按余额与流水差额判错。

AI 成本后台位于 `/admin/ai/costs`，使用独立 `ai.costs.read/manage` 权限。支持按原币种配置全站 `site` / 每账号 `user` 日预算和全局熔断，操作有版本保护并写入管理员审计。未保存数据库预算时兼容 `AI_DAILY_COST_BUDGETS`（如 `{"USD":{"site":10,"user":1}}`；只是运营示例，不是模型报价）；首次保存任意数据库币种条目后，数据库预算即全权接管，停用所有行也不会回退环境配置。统计按 UTC 日开始时间，独立于看板近 1/7/30/90 天范围；未知费用单独显示，模拟调用排除。该后台尚不配置模型单价和聊天金币扣费。

`AI_BUDGET_CIRCUIT_BREAKER` 默认 `false`，保持只提示、不停新调用。若数据库尚无 `AiCostPolicy` 记录，该环境变量兼容生效；通过 AI 成本后台保存策略后，数据库值实时优先且无需重启。只有已保存有效预算和匹配当前单模型的有效价格后才能启用熔断。开启后，发送与重生成在每日额度事务内核对预算：达到已记录费用阈值，或配置范围内已有已结束调用费用未知，返回 429，日额度与调用记录回滚，不写新消息、不破坏旧回复、不调用供应商。UTC 当日按调用开始日期归属，午夜重新核对新一天；缺少当前币种预算或模型价格无效时返回 503。实际预算和模型价格由运营确认，示例不作为默认生产值。

这不是费用预留或精确账单硬上限。已接纳的在途请求继续执行，费用可能越过阈值；单价是估算，供应商额外费用未完整提供时仍须账单核对。当前仅能定价 `AI_PRICE_MODEL`，未定价模型、未返回完整用量，以及多次尝试未返回逐次完整费用，都计为未知；历史多次尝试的末次估算也不再当作完整费用，原记录不改写。未知费用需要运营核对，不能自动按零清除。

完成调用或拒绝接纳时自动输出 `ai_budget_alert` / `ai_budget_blocked` 结构化告警；不包含聊天正文、认证密钥或模型价格，完成告警含调用 ID 供受控账务查询。监控查询失败记录 `ai_budget_monitor_failed`，不回滚已保存费用。邮件、推送及线上日志收集器由部署阶段配置，这里不自动向外部发送。熔断不扣金币、不改变充值套餐或聊天收费草案。

迁移 `20261013030000_ai_cost_budget_index` 仅增加 `(currency, started_at)` 索引，保留已有数据。上线前先备份，再 `prisma migrate deploy` / `prisma generate`。`test:m4:budget-guard` 使用新建隔离库；`test:m4:budget-guard:browser` 使用 18795 / 18796 的自有本机生产实例与本地供应商、生成测试密钥，结束后停止自有进程，证据保存在 `artifacts/ai-budget-browser/`。运行前须完成当前生产构建，不能指向正式用户数据。

退款功能默认关闭。商户后台须单独开启 EZFP V2 退款 API 后，设置 `EZFP_REFUNDS_ENABLED=true`；同时需满足 `EZFP_ENABLED=true`、平台公钥/商户私钥、商户 PID、HTTPS 回调站点等完整渠道配置。财务管理员只能发起整单退款，金币不足会阻止请求。结果不确定时金币冻结，先用 `/api/pay/query` 核对状态；重试会沿用首次生成的 `out_refund_no`。测试和上线前必须在真实商户沙箱验证退款开关、成功、拒绝、超时查单及重复请求。

EZFP_ENABLED 默认关闭。启用前配置商户 PID、商户私钥、平台公钥、HTTPS 站点与可从供应商访问的通知地址，并逐项设置确认过的 priceCnyCents。签名验证、金额匹配、重复回调和对账需要真实沙箱验收；模拟提供方通过不能替代它。

## 部署与排错

### 发布目标识别

用户已确认新 Khui 为后续唯一主项目，旧 `/opt/Toonflow-app`（`toonflow-app` 1.1.2 / 3728abc）已遗弃。切换前仍须只读核对 Nginx 上游、PM2 的 PID/cwd、Khui 发布目录及其 SQLite 数据库和上传目录；保留已存在的 Khui 用户数据，不自动导入 Toonflow 数据，也不未经用户确认改用空库。确认 Khui 数据路径并完成服务器联合备份后，才可运行 Khui 迁移和切换 PM2；不要读取或输出 `.env`。启动后验证 PM2 PID、工作目录、迁移数、公开健康检查及旧 Toonflow 服务已停止。若数据库或持久化目录无法确认，先停止切换，不能把旧 release 当作当前 Khui 版本。

本轮对服务器的只读 SSH 探测未通过：现有公钥认证被拒绝，未尝试密码登录。发布前需恢复本机 SSH 别名或由服务器添加专用部署公钥；不要在聊天中发送密码或私钥。

Next.js 已升级到 15.5.27、React 19.3.0，Node 24.21.0 的安装、迁移和当前主项目生产构建已验证。Tailwind 4.3.3 已合入，支持 Safari 16.4、Chrome 111、Firefox 128 及更新版本；主项目全依赖在线审计零告警，实际生产浏览器和恢复实例验证通过，详细范围见 `SECURITY.md`。保留修复前源码快照作排错，不部署旧漏洞版本。

社区回归支持 `TEST_BASE_URL` 和 `TEST_DATABASE_URL`，后者必须与服务实际数据库一致；还须设置 `TEST_ISOLATED_DB=true`。测试会创建账号、内容及审核动作，只用于本机隔离数据库。M3 证据默认保存在 `artifacts/m3-*`，不发布测试用户数据。限流应在稳定实例验证，开发热编译可能重新加载内存窗口。

财务页的付费验证指标按所选期间及报告生成时间读取同一事务快照。新用户付费率为期间注册且有同期人民币 EZFP 付款记录的用户数 / 期间注册用户数；付款订单退款率为同期付款订单中已确认整单退款数 / 同期付款订单数。分母为零显示暂无样本。每千次 AI 调用成本包含发送、重生成、失败与取消，排除模拟调用；有未知成本则无法计算，各币种分别显示，不将美元换算成人民币。缺少渠道费用、结算与完整人民币成本时毛利率保持无法计算。

目前没有经过验证的 Docker/Vercel 或 PostgreSQL 迁移方案。单机部署需持久化 SQLite 与上传目录，代理关闭 SSE 缓冲并留足读取超时。生产禁止模拟 AI/购买，无模型配置时返回不可用。

不要手动将 NODE_ENV=development 传入 next build，交由 Next 选择生产构建环境。生产构建目录与开发目录分开；重建正在使用的生产目录前停服务，完成后重启。Windows npm ci 前也应停使用依赖的 Next 进程。

套餐接口缺字段意味着代码与迁移版本不匹配：确认服务所属项目、DATABASE_URL 和已完成迁移，不能随意迁移另一份旧工作副本。Sandbox 的 spawn EPERM 或 blocked by policy 是工具权限限制，需要按宿主审批执行原命令，不靠改业务代码解决。

## 业务只读维护

第43条迁移后，运维配置管理员可在 `/admin/operations` 启停维护模式，设置用户提示和建议重试秒数；修改必须有理由并写管理审计，运维查看员仅可读。开关默认关闭，Node中间件从数据库读取当前状态，不需要重启服务。

开启后新业务提交返回503和Retry-After，页面查询、登录/退出、管理接口和GET支付通知继续处理，已开始请求也会完成。该模式适合短时暂停用户提交，不能当作数据库完全停写。执行数据库恢复、回滚或要求无并发写入的迁移时，仍需按既有流程停止应用和后台写入任务；不得仅凭前台维护通知开始覆盖数据。关闭后应验证普通业务提交恢复。当前仅通过本机隔离生产验收，服务器发布待SSH恢复后执行。

## 证书观察与续签验收

第44条迁移后，运维查看员可读取 `/admin/operations` 中最近的证书检查结果；运维配置管理员可触发一次检查。目标仅取 `NEXT_PUBLIC_SITE_URL` 的HTTPS主机与端口，5秒超时，不接收任意网页输入的URL，也不发送HTTP内容或认证凭据。未配置HTTPS地址时不执行检查。结果保存有效期、校验状态、指纹、安全原因码及检查时间，并写入管理审计；不保存完整证书链或私钥。

显示“有效”需要信任与域名校验均通过且处于有效期内；30天内到期会提示，过期状态会随当前时间更新。此处显示该次观察，不会配置ACME、自动续签或重载Nginx。正式续签仍需在服务器检查定时任务、实际执行、证书替换及HTTPS读取结果，不能以后台一次检查成功代替。

## 当前后台权限发布

2026-10-13当前应用发布目录为 `/www/wwwroot/khui-ai/releases/6e93498`；独立PM2与systemd保持启用，数据库与上传继续使用shared目录。第17条迁移新增管理身份、角色、权限关联和审计表，旧业务表迁移及所有者初始化前后内容一致，完整性/外键检查通过。上线前已原生构建并在数据库副本预启动验证，Linux33项隔离测试通过。

迁移前联合备份为 `releases/c4d8346/prisma/backups/database-before-admin-6e93498`，仅保留服务器。回退应用代码可使用原c4d8346发布目录，不删新管理表，不覆盖数据库；恢复数据库与完整业务回滚仍按前述停写/新目录恢复流程另行验收。首位所有者通过服务器 `npm run admin:bootstrap -- <已注册邮箱>` 显式指定，后续通过后台分配身份；不在HTTP接口暴露初始化命令。

2026-10-13用户管理发布：当前运行目录为 `/www/wwwroot/khui-ai/releases/a26f7bb`，生产迁移18条。迁移前联合备份为 `releases/6e93498/prisma/backups/database-before-accounts-a26f7bb`。原各表字段与记录校验保留；仅新增账户状态/时间字段、支持角色及系统所有者4项用户能力，保留已有自定义权限。服务器50项检查和预启动通过，健康服务及定时器active，HTTPS实际检查成功。验证命令必须同时显式配置隔离DATABASE_URL及UPLOADS_DIRECTORY；账户测试自行使用唯一库及artifacts上传目录。

2026-10-14角色管理发布：当前运行目录为 `/www/wwwroot/khui-ai/releases/760e82a`，生产20条迁移、所有者16项权限。第19条增加角色管理索引/系统能力，第20条新增上传资产site_owned，既有上传默认为个人资产。迁移前联合备份位于 `releases/a26f7bb/prisma/backups/database-before-characters-760e82a`，仅保留服务器。47张原业务表的原字段/记录保留核对、完整性及外键检查通过；原生构建、31项Linux隔离检查、副本预启动及实际所有者7页面390/1280px只读验收通过。PM2进程以www身份运行，新发布目录代码/依赖归root，仅构建缓存可由www写入；shared数据/上传/环境文件继续独立持久化。

## 2026-10-14 商业后台首阶段发布

当前运行目录：`/www/wwwroot/khui-ai/releases/commercial-20261014-1250`。服务器 Rocky Linux 9.2 / Node 24.14.1；PM2 `khui-ai` 与 `khui-ai-pm2.service` active/enabled。发布前在隔离目录以服务器 Node 原生执行 `npm run verify:build`，39 条迁移均在临时数据库验证。正式切换前保留了当前数据库联合备份：`/www/wwwroot/khui-ai/releases/760e82a/prisma/backups/database-before-commercial-39-20261014` 与 `database-before-commercial-39-cutover`；异地下载按用户决定暂缓。

正式 SQLite 应用至 39 条迁移。迁移后检查 `PRAGMA quick_check=ok`、`foreign_key_check` 无结果；对 48 张既有表逐表比较，记录数均未减少，账户与角色样本保留。公开 HTTPS 根路径跳转 `/zh` 后返回 200，`/discover`、`/api/site`、`/shop` 和健康检查通过；`X-Checkout-Enabled=false`，模拟购买与真实 AI 保持关闭；匿名 `/api/admin/access` 返回 401。回滚发布目录 `commercial-20261014-1245` 保留，联合恢复演练尚未完成，不能把目录切换等同于数据回滚验收。

## 2026-10-18 商业改造 8 阶段发布

当前运行目录：`/www/wwwroot/khui-ai/releases/commercial-20261018`（源码 = 本地 `commercial-refactor` 分支 `8417130`）。**无新增迁移**，生产库仍为 45 条，部署门禁 `node scripts/start-production.mjs --check-only` 通过（`release_migrations_compatible applied=45`）。

发布内容：后台移入独立 `(admin)` 路由组并统一到 `/admin/*`；67 个管理接口收敛到 `/api/admin/*`，旧前缀以 `next.config.mjs` 的 afterFiles 重写保留一个发布窗口；新增 `src/lib/http` 路由层，审核域匿名请求由 403 改为 401 且错误体统一为 `{error, code}`；泰语 key 全量替换为中文、公开页语言回退改中文；品牌残留与硬编码色清理，主导航收敛 5 项。

切换前联合备份：`releases/payment-amount-20261017/prisma/backups/database-before-commercial-20261018`（integrity ok、foreign_keys ok，74 张表记录数已记录）。构建方式：`git archive` 打源码包 → 新目录解压 → 复用同版本 `node_modules`（`package-lock.json` 与旧发布 md5 一致）→ `npx prisma generate` → `npm run verify:build`（隔离库，46 页 / 129 接口）→ 以生产库副本 `DATABASE_URL=file:/tmp/prerender-*.db NEXT_DIST_DIR=.next-build npm run build` 出正式构建（`BUILD_ID=5Mqy8PuZ1HsSRUURg4FFT`）。

切换前在 3100 端口用 `.next-build` 预启动逐项验收，通过后才切 PM2：`pm2 delete khui-ai` → 在新目录以 `script=scripts/start-production.mjs`、`cwd=<release>`、`interpreter=/usr/bin/node` 重启 → `pm2 describe` 确认 `exec cwd` 已是新目录 → `pm2 save`。环境变量与旧发布保持一致（`NEXT_DIST_DIR=.next-build`、`DISABLE_MOCK_AI=true`、`ALLOW_SIMULATED_PURCHASES=false`、`EZFP_ENABLED=false`、`AI_BUDGET_CIRCUIT_BREAKER=false`）。

线上实测（`https://lh.y-98.cn`）：21 个页面入口全 200（`/` 307 → `/zh`），`/finance`、`/moderation` 307 跳 `/admin/*`；公开接口 `/api/site`、`/api/characters`、`/api/circles`、`/api/coins/packages`、`/api/operations/status`、`/api/ai/models` 均 200；11 个匿名管理接口全部 401 且响应体 `{"error":"请先登录。","code":"UNAUTHORIZED"}`；5 条旧前缀兼容路径返回 401 而非 404；`/api/coins/orders`、`/api/coins/purchase`、`/api/conversations` 匿名 401，`/api/auth/login` 空体 400；`robots.txt` 含 `Disallow: /admin`；首页 0 处泰文字符，标题仍为「星伴 · AI 角色社区」。PM2 `error.log` 切换后零错误行。

回滚：`payment-amount-20261017` 目录与联合备份均保留，切回只需用同样参数在新旧目录间重建 PM2 条目；本次无迁移变更，回滚无数据库风险。已知遗留：`khui-ai-health.service` 的 `WorkingDirectory`/`ExecStart` 仍指向 `payment-amount-20261017`，属服务器配置，按底线未擅自改动，待负责人确认后再对齐到当前发布。

## 2026-10-18 B6 前端接口合同发布

当前运行目录：`/www/wwwroot/khui-ai/releases/commercial-20261018-b6`（源码 = `17c0301`），上一发布 `commercial-20261018` 保留为回滚位。无新增迁移，生产库仍 45 条，启动门禁通过；构建 `BUILD_ID=n7V19Z2UhQoI9un8T6r0x`。

新增 `src/lib/api-paths.ts`（前端接口路径唯一来源）、`src/lib/api-client.ts`（`ApiError` + `apiFetch`/`apiBlob`/`apiRaw`）、`src/lib/api-types/`；`STATUS_CODES` 从 `lib/http/errors.ts` 抽到 `lib/http/status-codes.ts`，服务端与客户端共用。8 个管理组件删掉各自的 `request` 封装改为调用 `apiFetch`，6 处客户端 `: any` 清零。同时清掉上一发布记录的 3 个遗留：中文支付文案的 `฿`、3 处 `font-athithi` 死类、品牌色字面量收敛到 `site-content/brand-defaults.ts`。

本地环境注意：本机 Prisma schema engine 无法创建 SQLite 文件（`unable to open database file`，node:sqlite 正常），所有依赖 `migrate deploy` 的套件在本机全部失败，属环境问题而非代码缺陷。本次改为在服务器发布目录内跑完整套件：16 个套件全绿，共 134 项断言（原 126 项 + 新增 `test:api:client` 8 项）。`npx tsc --noEmit` 本机 0 错误。

线上实测与上一发布一致：21 个页面入口全 200，11 个匿名管理接口全 401 且 `{error, code}`，5 条旧前缀兼容路径 401，公开接口与静态路由正常，首页 0 处泰文字符，PM2 error.log 切换后零错误。

回滚：`commercial-20261018`、`payment-amount-20261017` 两个目录均保留；无迁移变更，回滚无数据库风险。

## 本机开发环境（工具沙箱下的变通）

当前开发机的命令沙箱不允许**孙进程**写文件：`npm run test:*`（bash → npm → node）里的 Prisma schema engine 建不了库，`verify:build` 同样跑不动，报 `unable to open database file` 或 `OS Error 5`。同一路径用 `node:sqlite` 直连、或把 `next build` 作为**直接子进程**启动，都正常——这是环境限制，不是代码缺陷。

因此本机的分工是：

| 目的 | 命令 | 说明 |
| --- | --- | --- |
| 建本地库 | `npm run db:local` | 用 `node:sqlite` 按序执行 `prisma/migrations/*/migration.sql`，并写入带 epoch 毫秒时间戳的 `_prisma_migrations`，产物 `prisma/.local/dev.db`（45 条迁移、74 张表） |
| 本地构建 | `DATABASE_URL="file:$PWD/prisma/.local/dev.db" JWT_SECRET=local-build NODE_ENV=production NEXT_DIST_DIR=.temp/local-build node node_modules/next/dist/bin/next build` | 必须直接调 `next`，经 `npm run` 或包装脚本会退化成孙进程而失败 |
| 启动门禁 | `DATABASE_URL="file:$PWD/prisma/.local/dev.db" JWT_SECRET=x node scripts/start-production.mjs --check-only` | 读 `_prisma_migrations` 比对迁移，能正常返回 `release_migrations_compatible` |
| 全部离线测试 | **在服务器发布目录执行** `bash /tmp/run-suites.sh <发布目录>` | 本机跑不了，见上 |

`wsl.exe` 同样被安全策略拦截，容器/Docker 也不可用，不要再尝试用它们绕。

## 2026-10-18 B2 发现页分区与角色卡发布

当前运行目录：`/www/wwwroot/khui-ai/releases/commercial-20261018-b2`（源码 = `125e584`），`commercial-20261018-b6` 保留为回滚位。无新增迁移，生产库 45 条；构建 `BUILD_ID=B5erSpRaITBX3ieyLqkwN`。切换前联合备份沿用 `database-before-commercial-20261018`；本轮无库结构变化。

`/discover` 从「一串横滑 + 一个大网格」改成五个分区：今日推荐（独家优先的去重列表，桌面 3×2 网格）、热门（按对话数）、新角色（按创建时间）、关注的创作者（登录后出现）、榜单（复用排行榜组件，带「完整榜单」入口）。顶部搜索与类型/角色筛选改成只作用于页尾「全部角色」那一段，命中时整页切换为「筛选结果」并给出清除入口，不再把上面的分区一起压平。

分区数据来源：`/api/characters?sort=popular|new`、新增的 `scope=following`、以及既有的 `/api/rankings`。`scope=following` 走 `lib/characters/catalog-service` 的同一条查询，条件是「创作者被你关注 + 角色已公开且审核通过」，没有再开新接口。匿名访问返回 401，未知 scope 返回 400。列表投影新增 `likeCount` 与 `creator{username,displayName}`。

角色卡按建议书补齐信息密度：在原有封面、名称、一句话简介、徽章、对话框数之外，增加点赞数（与对话数并列）、创作者账号、最多两个中文标签（标签键由站点标签表映射）。`CharacterRail` 已删除——重构后它没有调用方，且其中的「今天/本周/本月/全部」范围按钮本来就不影响取数。

测试：`test:characters:management` 从 17 项增至 18 项，新增用例覆盖「关注分区只返回被关注创作者的角色」与「投影带 likeCount 与 creator」；服务器发布目录 16 个套件 135 项断言全绿。

线上实测：`/zh`、`/discover`、`/zh/explore`、`/shop`、`/admin` 均 200；`/api/characters?sort=popular` 返回 6 个角色且带 `likeCount`/`creator`/`tags`；`scope=following` 匿名 401、`scope=bogus` 400；PM2 error.log 零错误。

## 2026-10-18 B2 公开落地页发布

当前运行目录：`/www/wwwroot/khui-ai/releases/commercial-20261018-landing`（源码 = `4be03ec`），`commercial-20261018-b2` 保留为回滚位。无新增迁移；构建 `BUILD_ID=s0wxStcIk2wrnt9RG2RQG`；16 个套件 135 项断言全绿。

`/{locale}` 从「居中 Logo + 一行描述 + 一个按钮」改成建议书要求的七块结构：价值主张（含 AI 生成内容提示）、热门角色（取目录接口前 6 名，链接到公开角色页）、三步玩法、标注为示例的对话片段、安全与合规、原生 `<details>` 折叠的 FAQ、收尾 CTA；后台配置的首页横幅仍在顶部展示。SEO 侧补了 `generateMetadata`：标题为「价值主张 · 站点名」，带 canonical 与十语言 hreflang。

文案放在 `src/lib/i18n.ts` 新增的 `landing` 块（`LandingCopy` 类型）。中文与英文为人工撰写；泰语等其余语言暂时沿用英文——`getDictionary` 对未定义词典的 locale 本来回退英文，这里保持同样的可见缺口，没有机器翻译冒充。

一次构建告警：首次 `verify:build` 在 `/[locale]/explore` 预渲染时出现 11 次 `sqlite_pragmas_failed`（P2010）与两条 P1008 超时，删除 `.next-validation-build` 重跑后完全复现不了（0 次告警、构建通过）。判断是隔离库上的瞬时锁竞争，不是代码问题；重跑即通过，后续遇到同样报错先重跑一次再排查。

线上实测：`/zh` 七块文案全部服务端直出（各命中 1 次）、6 个角色链接、`<title>` 为「和你喜欢的角色，聊出属于你的故事 · 星伴 · AI 角色社区」、canonical 正确；`/en` 走英文文案；PM2 error.log 零错误。

## 2026-10-18 三个遗留坑的处理

1. **构建期 SQLite 锁竞争（P2010/P1008）**：根因是 `src/lib/db.ts` 先切 `journal_mode = WAL` 再设 `busy_timeout`。切换 WAL 需要排他锁，而这时还没有等待预算，构建期 116 页并发连接一抢就失败，连接退回回滚日志，预渲染查询随后超时。现在顺序改为先 `busy_timeout = 8000`、再切 WAL，切换失败按 120/240/360ms 退避重试 4 次；`scripts/start-production.mjs` 在启动 `next start` 之前用 `node:sqlite` 把库文件设成 WAL（WAL 是文件级设置，设一次后续连接直接继承）；`scripts/verify-production-build.mjs` 在 `migrate deploy` 之后、`next build` 之前对隔离库做同样处理。连续两次 `verify:build` 均通过、`sqlite_pragmas_failed` 为 0。
2. **健康检查单元指向旧发布目录**：脚本本身没有任何项目依赖，现固定为 `/www/wwwroot/khui-ai/shared/bin/check-site-health.mjs`，unit 的 `WorkingDirectory` 改为 `shared`。`systemctl daemon-reload` + 重启 timer 后实测 `site_health_ok`。以后切换发布不用再改 unit，`deploy/baota/khui-ai-health.service` 已同步。
3. **泰语落地页沿用英文**：补 `LANDING_TH`，`/th` 现在输出泰语价值主张、三步、示例、合规与 FAQ；仍建议上线前请母语同事过一遍用词。

## 2026-10-18 创作表单改分步向导

`creator/creator-form.tsx` 原来是「五个分区一次性铺开 + 右侧分区轨 + 滚动联动」的长表单，现在改成真正的分步向导：一次只渲染当前步骤，底部固定「上一步 / 第 N 步 / 下一步」，最后一步才出现提交按钮（移动端底栏同样处理）。

每一步都有独立闸门：身份要求名称与一句话简介、个性要求至少 40 字描述、开场要求开场白、标签要求至少一个、发布步骤在申请公开时要求版权声明。不满足就停在原地并给出中文提示，不会走到最后一步才发现缺项。

滚动联动（scroll spy）必须一起删：向导一次只挂载一个分区，滚动时它会把 active 依据「第一个分区」重置，导致每滚动一次就弹回第一步；`sectionRefs` / `scrollRoot` / `Card.refFn` 也随之移除，不留死代码。

部署备注：本轮发布期间 SSH 短时间被服务器限流，表现为 `Connection closed by 43.242.194.115 port 22`（站点本身正常，HTTPS 200）。恢复后重试即可，不是发布失败。
