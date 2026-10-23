# 多应用项目运行与发布检查

## 本机开发

要求 Node.js 22.13 或更高版本。首次安装执行 `npm ci`，将根目录 `.env.example` 复制为本机 `.env`，填写本机数据库和至少 32 字符的随机 JWT_SECRET。不要复制线上数据库、上传目录或支付密钥做本机验收。

`npm run db:generate` 根据 database/schema.prisma 生成 Prisma 客户端；修改模型后必须重新生成。根目录构建及会员集成测试会先执行此步骤。Windows 若提示 query_engine 文件 EPERM，应先停止当前工作区占用客户端的 API、worker 或测试进程，不应删除客户端绕过错误或终止无关 Node 进程。

`npm run db:init` 对配置的数据库执行迁移并写入可重复执行的种子数据。该命令会写数据库，不能将它当只读检查，也不要指向不准备修改的数据库。

`npm run dev` 启动四个独立进程：web 3010、admin 3011、api 3012、worker。浏览器从 web 入口访问，后台可经 `/admin` 代理访问或使用独立 admin 地址；API 和 worker 不承载前台页面。

## 地址与状态归属

- INTERNAL_API_ORIGIN、ADMIN_API_INTERNAL_URL：web/admin 服务端调用 API 的内部地址。
- INTERNAL_ADMIN_ORIGIN：web 代理后台及后台静态资源的内部地址。
- NEXT_PUBLIC_SITE_URL：浏览器可访问的前台地址，也是支付回调地址生成的基础。
- ADMIN_PUBLIC_ORIGIN：浏览器可访问的后台来源，用于独立后台 Cookie 写入校验，不是 API 内部地址。
- DATABASE_URL：相对路径以 database/schema.prisma 为基准；四个进程由统一环境加载器规范化为同一个绝对文件。
- UPLOADS_DIRECTORY、BACKUPS_DIRECTORY：生产环境应使用发布目录之外的持久目录，不能在切换版本时丢失。

Next 的代理 rewrite 在构建时写入产物。必须用目标内部地址构建；只在启动时修改端口不能重写已有构建产物。前台 `_next` 与后台 `/admin-assets` 分开，不能让反向代理将两者的资源路径混用。

## 验证命令与边界

```text
npm run architecture:check
npm run architecture:routes
npm run typecheck
npm run test:unit
npm run test:memberships
npm run test:worker
npm run test:tasks
npm run test:restore
npm run test:startup
npm run test:migration-upgrade
npm run build
npm run test:e2e:membership
```

会员集成测试、worker 测试自建临时 SQLite，拒绝外部 DATABASE_URL；运行前不要向它们注入生产环境变量。测试用本机签名支付桩证明状态机，不代表正式商户实际支付、到账和退款已经验收。

`test:startup` 使用真实安装入口创建临时数据库，然后由正式启动入口拉起四个进程；仍是本机隔离验证，不是线上部署。它与浏览器流程占用相同的默认端口，且安装会生成 Prisma 客户端，不要与其他服务或客户端生成测试并行运行。Windows 下生成客户端前须释放 DLL 占用。

浏览器流程位于 tests/e2e；独立后台登录页探测与带隔离账户的管理功能测试是不同脚本。运行 `npx playwright install chromium` 安装测试浏览器，三个应用以默认内部地址构建后，停止占用 3010/3011/3012 的服务，再执行 `npm run test:e2e:admin`；脚本自建账户和数据库并启动三个生产测试服务。仅登录页通过不能证明资料保存、配置联动或权益消费通过。具体覆盖与未覆盖项见各 validation 文档，不以路由清单代替逐项操作。

`npm run test:e2e:membership` 是前台已购会员专项验收：脚本自建临时 SQLite、会员套餐、已支付订单和续费订单，使用真实 `createMembershipOrder` / `markMembershipPaid` 及 billing `holdCharge` / `settleCharge` 准备测试状态，再启动隔离 API/Web 服务。PAID fixture 是测试数据，不是实际商户付款，不会调用真实支付或退款渠道；测试商户快照的退款开关保持关闭，并验证退款确认返回 `503 / REFUNDS_DISABLED`、前台不撤销权益。脚本结束会关闭浏览器和子进程并删除临时数据库。

## 生产发布与回滚闸门

1. 保留当前运行版本与数据库、上传文件的联合备份；先在隔离目录验证恢复与候选版本运行。
2. 在目标构建环境安装锁定依赖、生成客户端、设置目标内部地址并构建三个应用。worker 直接复用同一 backend 模块，不复制业务实现。
3. 明确本次数据库迁移和回滚方案。迁移不能因为应用目录切换而自动倒退；旧代码是否兼容新数据库必须单独验证。
4. 对目标数据库及候选发布目录执行 `npm run release:check -- <数据库绝对路径> <候选发布目录绝对路径>`。命令只读，遇到待应用、未知或失败迁移即拒绝兼容结论。
5. 迁移、功能、代理、资源路径和持久目录验收均通过后再安排切换。`npm start` 再做迁移一致性检查，设置 SQLite WAL，然后启动四个应用；它不会自动迁移数据库。
6. 正式支付和退款仍受服务器开关及商户配置控制。未经授权及正式渠道验收，不开启真实收款；页面显示订单成功不能代替验签回调入账。

正式渠道条件：商户需开启退款 API，并确认所选支付渠道支持部分金额退款。易支付的[退款文档](https://www.ezfp.cn/doc/pay_refund.html)列出了退款单号去重字段，也说明少数第三方插件不支持部分退款；不能只凭下单成功就认定可执行会员扣一天费用后的退款。当前实现使用新版[统一下单](https://www.ezfp.cn/doc/pay_create.html)和[支付通知](https://www.ezfp.cn/doc/pay_notify.html)接口，不混用旧版 MD5 接口约定。正式商户的实际到账、退款与权限开关仍需要单独验收。

当前工作区的本地通过记录不表示线上已发布。阶段状态以 architecture-plan.json 及当前执行输出为准。

## Linux / PM2 人工发布步骤

以下步骤只描述人工操作顺序，不代表已经连接或验证任何线上环境。`<release-absolute>`、`<database-absolute>`、`<uploads-absolute>` 和 `<backups-absolute>` 必须由实际运维环境明确填写，不能使用猜测路径。

1. 保留正在运行的旧 release，不覆盖其目录。将候选源码放到新的固定绝对路径 `<release-absolute>`，确认该路径包含 `apps/`、`packages/`、`database/` 和 `ops/`。

2. 在安装和构建前先准备候选环境。Next rewrite 会在构建时固化内部地址，不能构建完成后才修改这些值：

   ```text
   DATABASE_URL=file:<database-absolute>
   UPLOADS_DIRECTORY=<uploads-absolute>
   BACKUPS_DIRECTORY=<backups-absolute>
   NEXT_PUBLIC_SITE_URL=<web-origin>
   INTERNAL_API_ORIGIN=<api-origin>
   ADMIN_API_INTERNAL_URL=<api-origin>
   INTERNAL_ADMIN_ORIGIN=<admin-origin>
   ADMIN_PUBLIC_ORIGIN=<admin-origin>
   EZFP_ENABLED=false
   EZFP_REFUNDS_ENABLED=false
   ```

   这些值必须指向本次候选环境；上传和备份目录不能位于候选 release 内。支付开关只有在另行完成正式商户验收并获得明确授权后才可改变。

3. 在候选目录安装完整锁定依赖（生产 worker 当前通过 `tsx` 加载源码，因此不能省略 devDependencies）：

   ```text
   cd <release-absolute>
   npm ci --include=dev
   npm run db:generate
   npm run build
   ```

4. 若候选包含新迁移，先停止写入，完成数据库与上传目录联合备份，并在隔离恢复目录验证候选版本。只有隔离验证和变更授权都通过后，才允许对目标数据库执行迁移：

   ```text
   cd <release-absolute>
   npx prisma migrate deploy --schema database/schema.prisma
   ```

   `release:check` 只检查迁移历史兼容性，不会执行迁移；没有完成停写、备份和授权时不得运行 `migrate deploy`。

5. 发布前执行只读迁移闸门：

   ```text
   npm run release:check -- <database-absolute> <release-absolute>
   ```

   该命令失败时停止发布。不要用 `db:init` 代替 release check；`db:init` 会写入数据库并执行种子。

6. PM2 只管理一个默认 fork 模式的 root launcher，不要另外启动 API、Admin、Web 或 worker。根入口会编排四个子进程，重复启动 worker 会造成多个任务执行 owner。直接管理 Node 脚本，不使用 npm shell wrapper：

   ```text
   pm2 start <release-absolute>/ops/scripts/start-production.mjs --interpreter node --name xingban-root --cwd <release-absolute> --kill-timeout 30000
   ```

   PM2 显示 online 只代表 root launcher 进程存在，不代表四个应用已经 readiness。发布人员必须从实际可访问地址逐项检查 API、Admin 和 Web：

   ```text
   curl -fS <api-origin>/api/memberships
   curl -fS <admin-origin>/admin/login
   curl -fS <web-origin>/api/memberships
   ```

   任一检查失败，先停止候选 PM2 进程并保留旧 release；不要先覆盖旧目录，也不要在候选未通过时切换反向代理。

7. 若本次包含新迁移，不能直接把代码目录回滚到旧版本继续写同一个数据库。必须先停止写入，确认旧版本与当前数据库迁移兼容；若不兼容，只能依据联合备份在隔离目录恢复并核验数据库与上传文件，再决定是否切换旧版本。禁止用删除迁移记录或手工倒退 `_prisma_migrations` 的方式回滚。

8. 三项 readiness 均通过后再执行 `pm2 save`，并记录 release 路径、数据库绝对路径、上传/备份持久目录、迁移闸门结果和 readiness 结果。收款开关仍保持关闭，直到正式支付、回调到账和部分退款能力另行完成验收。
