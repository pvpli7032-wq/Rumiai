# 本机运行与运维

宝塔目标域名为 `lh.y-98.cn`，单进程 PM2 与 Nginx 配置见 [宝塔部署说明](deploy/baota/README.md)。用户关闭 TUN 后连接恢复，已完成 Linux 依赖安装、16 条迁移、生产构建和 HTTPS 入口部署；服务器及本机证书检查与发现页 200、HTTP 301 通过。服务以 www 运行，独立 systemd 单元 active/enabled。完整上线门禁仍待验收，真实 AI 和支付关闭。

当前项目使用 SQLite 和本机文件上传，先完成隔离验证再评估部署。密钥只放在不提交的本地环境文件，不放进源码或日志。数据库、上传和密钥都是持久数据，删除缓存不能连带删除这些内容。

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

示例路径须换成实际部署路径。恢复只创建全新目录，检查数据库、持久引用和上传文件大小/SHA256；默认上传位置为 `public/uploads`。同时切换数据库与上传配置，人工更换随机 JWT 密钥后再启动，避免恢复旧凭据后旧令牌重新有效；脚本不会自动修改 `.env`。恢复目录的清单只记录恢复时间点，重新写入后不作为未改动的备份校验。来源须可信，敏感备份限制访问并保护异地副本；环境密钥、部署配置独立保管，脚本不复制根目录 `.env`。失败的部分目标保留检查，重试用新标签/新目录。

服务切换步骤：停止当前实例并暂停写入 → 另存当前数据库与上传 → 恢复到新文件 → 配置 DATABASE_URL 指向恢复库 → 检查应用版本与迁移历史匹配 → 在关闭真实 AI/支付的本机实例检查登录、角色、聊天及财务流水 → 核验后恢复访问。出错时停实例，将 DATABASE_URL 指回保留的旧库并恢复相应应用版本；恢复后已有新写入时先保存两份数据再人工核对，不直接切回丢弃新增记录。当前脚本不自动停止服务、修改 .env、覆盖旧库或执行数据回滚。

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

参考 .env.example。JWT_SECRET 至少 32 字符且随机；OPENAI_BASE_URL、AI_MODEL 与备用模型决定兼容 AI 服务。AI_CONNECT_TIMEOUT_MS、AI_REQUEST_TIMEOUT_MS、AI_STREAM_IDLE_TIMEOUT_MS 与 AI_MAX_RETRIES 控制预算。CHAT_DAILY_LIMIT 是调用上限而非独立免费商品额度。

MODERATOR_USER_IDS 是审核用户 ID 白名单。AI 输入/输出单价未知时保持空值；币种和 AI_PRICE_MODEL 必须对应确认的单价。

PAYMENT_ADMIN_USER_IDS 是独立的财务用户 ID 白名单，默认不授予任何人权限，不继承内容审核角色。登录该账号后访问 `/finance`；报告按 1/7/30/90 天汇总本地订单金额、已完成退款及各币种 AI 成本，对所有留存订单核对充值/退款流水并列出负余额。它不核实渠道账单，也不会自动纠正账本。未知模型成本不记作零，历史期初余额未登记前不按余额与流水差额判错。

`AI_DAILY_COST_BUDGETS` 为空时关闭预算提示。配置格式如 `{"USD":{"site":10,"user":1}}`，数值是运营自行确定的币种日预算示例，不是模型报价；支持全站 `site` 和每账号 `user`，均须为正数。按 UTC 午夜至报告生成时汇总，独立于页面近 1/7/30/90 天选择；达到额度即提示，未知成本单独显示，模拟调用排除。无效配置会在看板显示错误。

`AI_BUDGET_CIRCUIT_BREAKER` 默认 `false`，保持只提示、不停新调用。明确设为 `true` 后，发送与重生成在每日额度事务内核对预算：达到已记录费用阈值，或配置范围内已有已结束调用费用未知，返回 429，日额度与调用记录回滚，不写新消息、不破坏旧回复、不调用供应商。UTC 当日按调用开始日期归属，午夜重新核对新一天；修改配置需重启当前实例。开启却缺少当前币种预算、模型单价无效或开关不是 true/false 时返回 503；财务页显示配置状态。实际预算和模型价格由运营确认，示例不作为默认生产值。

这不是费用预留或精确账单硬上限。已接纳的在途请求继续执行，费用可能越过阈值；单价是估算，供应商额外费用未完整提供时仍须账单核对。当前仅能定价 `AI_PRICE_MODEL`，未定价模型、未返回完整用量，以及多次尝试未返回逐次完整费用，都计为未知；历史多次尝试的末次估算也不再当作完整费用，原记录不改写。未知费用需要运营核对，不能自动按零清除。

完成调用或拒绝接纳时自动输出 `ai_budget_alert` / `ai_budget_blocked` 结构化告警；不包含聊天正文、认证密钥或模型价格，完成告警含调用 ID 供受控账务查询。监控查询失败记录 `ai_budget_monitor_failed`，不回滚已保存费用。邮件、推送及线上日志收集器由部署阶段配置，这里不自动向外部发送。熔断不扣金币、不改变充值套餐或聊天收费草案。

迁移 `20261013030000_ai_cost_budget_index` 仅增加 `(currency, started_at)` 索引，保留已有数据。上线前先备份，再 `prisma migrate deploy` / `prisma generate`。`test:m4:budget-guard` 使用新建隔离库；`test:m4:budget-guard:browser` 使用 18795 / 18796 的自有本机生产实例与本地供应商、生成测试密钥，结束后停止自有进程，证据保存在 `artifacts/ai-budget-browser/`。运行前须完成当前生产构建，不能指向正式用户数据。

退款功能默认关闭。商户后台须单独开启 EZFP V2 退款 API 后，设置 `EZFP_REFUNDS_ENABLED=true`；同时需满足 `EZFP_ENABLED=true`、平台公钥/商户私钥、商户 PID、HTTPS 回调站点等完整渠道配置。财务管理员只能发起整单退款，金币不足会阻止请求。结果不确定时金币冻结，先用 `/api/pay/query` 核对状态；重试会沿用首次生成的 `out_refund_no`。测试和上线前必须在真实商户沙箱验证退款开关、成功、拒绝、超时查单及重复请求。

EZFP_ENABLED 默认关闭。启用前配置商户 PID、商户私钥、平台公钥、HTTPS 站点与可从供应商访问的通知地址，并逐项设置确认过的 priceCnyCents。签名验证、金额匹配、重复回调和对账需要真实沙箱验收；模拟提供方通过不能替代它。

## 部署与排错

Next.js 已升级到 15.5.27、React 19.3.0，Node 24.21.0 的安装、迁移和当前主项目生产构建已验证。Tailwind 4.3.3 已合入，支持 Safari 16.4、Chrome 111、Firefox 128 及更新版本；主项目全依赖在线审计零告警，实际生产浏览器和恢复实例验证通过，详细范围见 `SECURITY.md`。保留修复前源码快照作排错，不部署旧漏洞版本。

社区回归支持 `TEST_BASE_URL` 和 `TEST_DATABASE_URL`，后者必须与服务实际数据库一致；还须设置 `TEST_ISOLATED_DB=true`。测试会创建账号、内容及审核动作，只用于本机隔离数据库。M3 证据默认保存在 `artifacts/m3-*`，不发布测试用户数据。限流应在稳定实例验证，开发热编译可能重新加载内存窗口。

财务页的付费验证指标按所选期间及报告生成时间读取同一事务快照。新用户付费率为期间注册且有同期人民币 EZFP 付款记录的用户数 / 期间注册用户数；付款订单退款率为同期付款订单中已确认整单退款数 / 同期付款订单数。分母为零显示暂无样本。每千次 AI 调用成本包含发送、重生成、失败与取消，排除模拟调用；有未知成本则无法计算，各币种分别显示，不将美元换算成人民币。缺少渠道费用、结算与完整人民币成本时毛利率保持无法计算。

目前没有经过验证的 Docker/Vercel 或 PostgreSQL 迁移方案。单机部署需持久化 SQLite 与上传目录，代理关闭 SSE 缓冲并留足读取超时。生产禁止模拟 AI/购买，无模型配置时返回不可用。

不要手动将 NODE_ENV=development 传入 next build，交由 Next 选择生产构建环境。生产构建目录与开发目录分开；重建正在使用的生产目录前停服务，完成后重启。Windows npm ci 前也应停使用依赖的 Next 进程。

套餐接口缺字段意味着代码与迁移版本不匹配：确认服务所属项目、DATABASE_URL 和已完成迁移，不能随意迁移另一份旧工作副本。Sandbox 的 spawn EPERM 或 blocked by policy 是工具权限限制，需要按宿主审批执行原命令，不靠改业务代码解决。

## 当前后台权限发布

2026-10-13当前应用发布目录为 `/www/wwwroot/khui-ai/releases/6e93498`；独立PM2与systemd保持启用，数据库与上传继续使用shared目录。第17条迁移新增管理身份、角色、权限关联和审计表，旧业务表迁移及所有者初始化前后内容一致，完整性/外键检查通过。上线前已原生构建并在数据库副本预启动验证，Linux33项隔离测试通过。

迁移前联合备份为 `releases/c4d8346/prisma/backups/database-before-admin-6e93498`，仅保留服务器。回退应用代码可使用原c4d8346发布目录，不删新管理表，不覆盖数据库；恢复数据库与完整业务回滚仍按前述停写/新目录恢复流程另行验收。首位所有者通过服务器 `npm run admin:bootstrap -- <已注册邮箱>` 显式指定，后续通过后台分配身份；不在HTTP接口暴露初始化命令。

2026-10-13用户管理发布：当前运行目录为 `/www/wwwroot/khui-ai/releases/a26f7bb`，生产迁移18条。迁移前联合备份为 `releases/6e93498/prisma/backups/database-before-accounts-a26f7bb`。原各表字段与记录校验保留；仅新增账户状态/时间字段、支持角色及系统所有者4项用户能力，保留已有自定义权限。服务器50项检查和预启动通过，健康服务及定时器active，HTTPS实际检查成功。验证命令必须同时显式配置隔离DATABASE_URL及UPLOADS_DIRECTORY；账户测试自行使用唯一库及artifacts上传目录。

2026-10-14角色管理发布：当前运行目录为 `/www/wwwroot/khui-ai/releases/760e82a`，生产20条迁移、所有者16项权限。第19条增加角色管理索引/系统能力，第20条新增上传资产site_owned，既有上传默认为个人资产。迁移前联合备份位于 `releases/a26f7bb/prisma/backups/database-before-characters-760e82a`，仅保留服务器。47张原业务表的原字段/记录保留核对、完整性及外键检查通过；原生构建、31项Linux隔离检查、副本预启动及实际所有者7页面390/1280px只读验收通过。PM2进程以www身份运行，新发布目录代码/依赖归root，仅构建缓存可由www写入；shared数据/上传/环境文件继续独立持久化。
