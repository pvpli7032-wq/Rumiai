# 星伴 · AI 角色社区

基于 Khui AI 的 MIT 源码维护，技术栈为 Next.js 15、React 19、TypeScript、Prisma 5 与 SQLite。原许可和版权保留在 [LICENSE](LICENSE)。项目目前用于本机研发；真实商户支付与真机 PWA 验收尚未完成。

界面构建已迁移到 Tailwind 4；按用户确认，支持 Safari 16.4、Chrome 111、Firefox 128 及更新浏览器。

当前源码已通过 Node 24 生产构建、类型检查、全依赖审计（零漏洞）、160 项本地 HTTP/SSE 回归及核心生产浏览器验证；范围与尚未完成的真实上线事项见 [任务进度](docs/任务进度.md)。旧调色板的上游声明见 [第三方许可](THIRD_PARTY_NOTICES.md)。

## 本地运行

推荐 Node.js 24；Node 24.21.0 的独立安装、迁移和生产构建已验证，本机系统 Node 22 保持原样。将 `.env.example` 复制为不提交的 `.env`，设置数据库地址、至少 32 字符的随机 `JWT_SECRET`，需要真实 AI 时再配置模型密钥。

```powershell
npm ci
npm run db:init
npm run dev
```

打开 http://localhost:3000/discover 注册账号。`db:init` 创建缺失的 SQLite 文件、应用现有有序迁移、生成 Prisma client 并初始化原创角色和站点内容；不清空已有数据。数据库相对路径以 `prisma` 目录解析。可用 `npm run db:seed:community` 补充内测角色和圈子。迁移历史必须完整保留，不使用 reset 或 db push 替代迁移。

生产模式本机运行：

```powershell
npm run build
npm start -- --hostname 127.0.0.1 --port 18781
```

构建与启动使用 `.next-build`，开发服务使用 `.next`。直接调用 Next CLI 时需显式设置 `NEXT_DIST_DIR=.next-build`。隔离数据库和关闭模型/支付的完整启动步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 已实现功能

数据库与上传联合备份：停写后 `npm run state:backup -- <标签>`；`npm run state:restore -- <备份目录> <全新目录>` 恢复并核验文件引用和完整性。恢复时同时设置 `DATABASE_URL` 和 `UPLOADS_DIRECTORY`；密钥独立保管，具体切换步骤见部署说明。

- 注册、登录、账户资料、原创角色创建和编辑、审核公开、收藏、点赞、评论与举报。
- AI 流式聊天、模型白名单、超时和有限重试、每日调用上限、用量与可选成本估算、会话归档/导出/删除、消息举报。
- 圈子订阅、帖子与图文评论、创作者关注和动态、举报处置、申诉与审计。审核账号通过服务端 `MODERATOR_USER_IDS` 配置。
- 签到、任务、礼物与金币流水；EZFP V2 签名/验签、订单金额快照、建单幂等与验证回调后的事务入账。页面返回不发金币。
- 财务管理员可在 `/finance` 查看本地订单/流水异常、负余额及按币种拆分的 AI 已知/未知成本。权限由 `PAYMENT_ADMIN_USER_IDS` 单独配置。
- 财务页支持按 UTC 当日核对全站及每账号 AI 成本预算，按币种分别提示达限、未知成本和未配置币种；阈值由服务端 `AI_DAILY_COST_BUDGETS` 配置，默认关闭。
- 财务页提供新注册用户付费率、付款订单退款率和各币种每千次 AI 调用成本。未知成本时不计算千次成本，缺少渠道费用与完整人民币成本时不计算毛利率；这是 M4-05 本地指标准备，不是实付验收。
- SQLite 一致性备份、完整性/外键/迁移检查及恢复到新文件；隔离恢复演练覆盖聊天、余额、流水和迁移历史，详见部署说明。
- 财务管理员可以按 EZFP V2 发起整单退款。退款单、操作理由、金币冻结/返还流水保留；渠道结果不明时冻结金币并支持查单与同单号重试。功能默认关闭。
- 财务管理员可在 `/finance` 新增/编辑充值套餐、上下架及定时赠送金币，并查看修改记录。默认套餐为 ¥6/60、¥10/100、¥30/300 金币；旧订单保留原报价，商城报价变化需刷新确认。
- 中文应用界面、本地化公共页面、阅读设置；PWA 清单、公共离线页及更新提示；个人资料页支持导出本人账号数据。
- 个人页可密码确认注销，清除本人内容及已归属上传，保留匿名账务/举报审计和其他用户历史；旧共享文件待核查。上传图片支持生产动态读取与私有访问校验。

模拟 AI 仅在显式允许的开发环境使用并带永久标记；生产环境无密钥返回不可用。模拟购买同样只允许开发环境显式开启。商城人民币价格来自 `priceCnyCents`，旧 `priceThb` 保留为历史字段，不自动换算。缺少人民币价格或商户配置时关闭支付按钮。

## 测试

无需运行服务的主要检查：

```powershell
npm run typecheck
npm run test:m0
npm run test:m2:context
npm run test:m4:ezfp
npm run test:m4:budget
npm run test:m4:metrics
npm run test:m5:backup
npm run test:m5:export
npm run test:m5:closure
```

支付自动化测试只用合成 RSA 密钥、本地 mock provider 和一次性隔离数据库，不进行真实扣款。`test:m4:ezfp:browser` 在 `TEST_BASE_URL` 指向的隔离服务上检查商城、套餐接口、支付按钮和手机布局，完整步骤见部署说明。

`npm test` 是 HTTP/SSE 集成测试，会创建账号、角色和交易，必须指向已明确隔离的开发服务，关闭真实 AI、显式允许测试模拟购买，并准备隔离审核账号。四组测试覆盖功能、边界、跨功能和用户流程；不要把它运行在体验库或生产库上。各 `test:m1:*`、`test:m2:*`、`test:m3:*` 命令仍用于对应功能回归，部分脚本固定隔离端口/数据库，请先查看脚本的环境要求。

`verify-ai-context.mjs`、`verify-rate-limit.mjs` 使用本地模型替身；`stress-economy.mjs` 用于隔离服务并发检查。`test:real-ai` 会真实调用一次模型，应只在已授权且配置完整时运行。浏览器检查需要 `npx playwright install chromium`；若使用自定义安装目录，安装与测试须设置相同的 `PLAYWRIGHT_BROWSERS_PATH`。

## 产品决策与待完成工作

主付费路径为“每日免费 AI 对话额度 + 一次性充值金币”，暂不做会员订阅、自动续费或创作者分成。`CHAT_DAILY_LIMIT` 是 UTC 日历日调用接纳上限，不等于产品承诺的免费额度；独立免费规则和对话扣币仍待实现。

具体规则、待定参数与实施范围见 [收费方案草案](docs/M4-01-收费方案草案.md)。对话计费未启用；模型成本与免费次数/每次金币价仍待确认。
充值三档已按用户确认实现，活动可从财务后台配置；每日免费次数及对话金币价格仍待确认，聊天扣币未启用。`db:seed:site` 创建缺失的默认人民币套餐，保留后台编辑，仅下架原来未配置人民币价的六档种子套餐。

启用收费前还需确认模型成本、人民币套餐和兑换率，完成真实商户沙箱购买/回调/退款验证、可访问 HTTPS 回调、历史期初流水及支付渠道账单对账。本地退款和订单/流水对账已实现，但只用本地 mock 验证，不能替代渠道沙箱。AI 成本为空表示未知，不能视为零成本。退款保留原交易。真机安装、软键盘和独立窗口体验仍需 Android/iOS 验收。

## 维护资料

- [ARCHITECTURE.md](ARCHITECTURE.md)：当前模块地图、边界和数据流程。
- [DEPLOYMENT.md](DEPLOYMENT.md)：配置、隔离运行、迁移、备份与排错。
- [备份恢复演练](docs/M5-03-备份恢复演练.md)：本地验证范围、演练成果与待完成运维事项。
- [AGENTS.md](AGENTS.md)：全项目开发规则。
- [任务进度](docs/任务进度.md)：按原计划编号跟踪完成证据、剩余工作与外部依赖。
- [内容来源登记](docs/M3-06-content-source-register.md)：内测角色和素材来源、使用边界。
- [实施计划书](docs/项目实施计划书_v1.0.docx)：后续产品计划；实现状态以代码和当前文档为准。

历史阶段公告、代理交接和重复验收报告不再作为现行文档维护。
