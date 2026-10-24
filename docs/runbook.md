# 运行、验证与发布

## 批准环境与初始化

所有检查、开发、调试、测试和发布仅在 AGENTS.md 允许的云环境或明确授权的宝塔项目执行，不使用用户本机或本机副本。执行位置和运行模式必须先核对；命令存在不代表允许它对线上数据写入。

要求 Node.js 22.13 或更高版本。新工作区先执行 npm ci --include=dev，再按根 .env.example 准备该环境自己的配置。不要把真实数据库、环境配置、上传文件或密钥复制进 Git。生产 worker 通过 tsx 加载源码，安装时需要 devDependencies。

npm run db:generate 从 database/schema.prisma 生成客户端。根 build 和 test:memberships 会先生成客户端；其他测试按自己的入口要求执行。npm run db:init 会执行迁移和种子写入，只用于明确授权的新数据库，不是只读检查或发布检查。

npm run dev 编排 web、admin、api、worker。默认 HTTP 端口分别为3010、3011、3012，可由 WEB_PORT、ADMIN_PORT、API_PORT 覆盖；worker不监听HTTP。后台可经前台/admin代理或独立后台来源访问。

## 环境与持久数据

| 配置 | 用途 |
| --- | --- |
| INTERNAL_API_ORIGIN、ADMIN_API_INTERNAL_URL | 前后台服务端调用API的内部地址 |
| INTERNAL_ADMIN_ORIGIN | 前台代理后台及其静态资源的地址 |
| NEXT_PUBLIC_SITE_URL | 浏览器可访问的前台来源 |
| ADMIN_PUBLIC_ORIGIN | 独立后台Cookie来源校验 |
| DATABASE_URL | 四个进程使用的数据库地址 |
| UPLOADS_DIRECTORY、BACKUPS_DIRECTORY | 上传与备份的持久目录 |

环境统一由 ops/runtime/environment.mjs 加载；SQLite相对地址以database/schema.prisma为基准转换为绝对地址。实际配置、数据库和上传文件位于服务器shared持久目录，发布切换不得将其覆盖。文件名、路径和权限以实际运行配置为准；不在文档或Git保存凭据与运行快照。

Next代理rewrite会固化到构建产物。构建前设置目标内部地址，启动时改端口不能修正旧产物。前台_next与后台/admin-assets资源分开；候选使用独立NEXT_DIST_DIR时，不把该候选类型路径带入通用源码配置。

## 检查入口与结果

在不会占用生产端口、写生产数据的批准工作区按本次改动选择检查：

```text
npm run architecture:check
npm run architecture:routes
npm run typecheck
npm run test:unit
npm run test:memberships
npm run test:worker
npm run test:tasks
npm run test:restore
npm run test:migration-upgrade
npm run build
npm run test:startup
```

路由清单由architecture:routes写入artifacts/route-inventory.json。会员、worker、tasks及迁移升级结果由对应runner写入artifacts/validation-*.json；这些结果文件不入Git。路由可打开、构建通过和结构清单不能替代受影响业务实际验收。

npm run test:startup需要先完成npm run build并具备API、Admin、Web三个BUILD_ID，随后使用专用隔离端口3430、3431、3432，不占用默认生产端口。测试以Web静态manifest检查readiness，避免构建时固定的rewrite把隔离探测发到线上API。执行前确认这三个隔离端口空闲；不要把启动检查移动到build之前。

领域和浏览器测试入口见package.json与tests/e2e。测试需要Playwright Chromium；在批准环境安装浏览器，先检查服务端口是否空闲。隔离runner会自建SQLite和测试账户、启动服务并清理；不要向它们注入生产DATABASE_URL，不要与占用相同端口或生成同一Prisma客户端的测试并行。

npm run test:e2e:admin验证独立后台登录、权限与真实表单联动；npm run test:e2e:membership验证隔离已购会员、退款试算、取消确认和关闭渠道的失败状态。PAID fixture、签名桩和临时RSA密钥均不代表真实商户收款、到账或退款。前台改动先完成build，再运行npm run test:e2e:frontend及相关domain脚本；该入口加载tsx并使用当前工作区产物，缺失构建时明确失败，不再需要历史M6阶段开关。按其环境参数使用独立fixture；截图覆盖实际页面、空/单项/错误等相关状态，手机布局核对360/390/430px及浅深色。

tests/e2e/server-membership-config.mjs等server脚本会修改实际配置，必须有明确指定的测试目标、账号和写入授权，不能当作只读巡检直接运行。不要删除测试，仅因它未被业务代码import；使用测试命令和覆盖责任判断用途。

## 服务器优先发布

默认流程为服务器核对有效源码与运行基线、在独立源码/构建目录修改和验证、按授权切换、检查公开站点与资源、再同步已发布源码到GitHub。不要覆盖正在运行的生成文件，也不要用开发热更新服务作为公网正式服务。

1. 核对current的realpath、运行进程cwd、各应用构建路径、公开地址、持久目录和开关。保留旧有效产物及恢复信息。小改动只构建受影响应用，跨模块与数据结构变更扩大验证。
2. 构建前设置目标地址、安装锁定依赖并生成客户端。无迁移的前台改动不执行数据库迁移或种子；不重建未改动服务来冒充前台验收。
3. 有新迁移时，先明确授权、停写、联合备份和隔离恢复验证，再决定目标迁移。npm run release:check -- <数据库绝对路径> <候选发布目录>只检查迁移兼容性；npm start再次检查迁移一致性，不会自动迁移。
4. 候选功能、代理与静态资源验证通过后按本次授权切换。检查HTTPS页面、构建ID和真实静态资源，确认API/Admin/Web正常、worker唯一、持久目录和商业开关未意外变化。
5. 记录有效源码、构建产物、切换地址、进程cwd、验证结果与未覆盖边界。失败时恢复最后有效应用产物；不能通过删迁移记录或把旧代码直接指向不兼容的新数据库来回滚。

全量新安装的标准启动入口为npm start，使用ops/scripts/start-production.mjs与ops/runtime/run-apps.mjs编排四个应用。PM2按现有部署方式管理root launcher，不另外重复启动worker；PM2 online本身不证明子服务readiness。既有分应用发布应保留实际有效cwd/构建配置，不用默认示例覆盖。

生产备份/恢复使用npm run state:backup、npm run state:restore，数据库单项工具为db:backup、db:restore；均先读对应ops/scripts入口和参数并明确目标。数据迁移和恢复属于写操作，不能由本手册自动授权。

## Git同步与商业边界

Git只提交源码、必要配置、迁移与可重复运行的测试。排除node_modules、.next*、env、数据库、上传/备份、tsbuildinfo、artifacts及private-data历史快照。迁移目录是源码，不能因为“排除数据库”而误删；上传相关业务模块同样是源码，不能广泛按uploads名称排除。

同步前检查线上独有改动、源分支、目标main和实际diff，避免把旧服务器修复误报为单次前台变更。校验允许路径与敏感数据边界后提交，推送前重新核对远端main与祖先关系，使用普通快进push。凭据由授权会话瞬态提供，不打印、不写入仓库；不force push，不把Git同步等同重新部署。

真实收款、退款和付费AI调用按现有服务器开关及明确授权执行。套餐金额、权益和退款参数来自后台与订单快照，不由文档或前台编造。正式渠道还需单独验证验签回调、真实到账与部分金额退款；隔离测试通过不能代替商户验收。
