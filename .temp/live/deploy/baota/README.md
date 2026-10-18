# 宝塔部署：lh.y-98.cn

## 当前部署边界

当前发布为 `releases/commercial-20261017-admin44`、44条迁移，原shared数据保留。2026-10-17已通过SSH现场确认并升级原Khui39迁移版本，未使用旧Toonflow数据。以后部署仍以实际PM2工作目录和数据库归属为准。

SSH现已通过本机专用密钥直接连接，无需别名。当前版本的Linux构建、数据副本预启动、迁移保留、公网管理页面及健康手动检查已通过。完整业务回滚、真实渠道和后续验收见 [DEPLOYMENT](../../DEPLOYMENT.md)。

## 目录与持久数据

| 内容 | 归属与要求 |
|---|---|
| 发布源码与Linux依赖 | `/www/wwwroot/khui-ai/releases/<唯一版本>`；代码和依赖归部署用户管理，运行用户无需写权限 |
| 数据库 | `/www/wwwroot/khui-ai/shared/database.db`；先确认它确实是历史Khui业务库，不能复制Toonflow库代替 |
| 上传 | `/www/wwwroot/khui-ai/shared/uploads`；与数据库同时备份、恢复，运行用户可写 |
| 环境配置 | `/www/wwwroot/khui-ai/shared/app.env`；受保护，发布目录链接到它，禁止打入源码包 |
| PM2 | `shared/pm2`；仅本项目使用，运行用户为www |
| 构建缓存 | 发布目录的`.next-build`；由www可写，不与持久数据混放 |

`DATABASE_URL`使用已确认的数据库绝对路径，`UPLOADS_DIRECTORY`指向同一实例的上传目录。shared权限700，环境文件权限600。JWT、供应商与商户加密主密钥独立保管；保留既有加密主密钥以读取历史配置。恢复数据库时需轮换JWT，不能随意更换加密主密钥导致旧商户版本不可用。

源码上传不包含`.env`、数据库及其伴随文件、备份、用户上传、Windows依赖、构建缓存、测试产物或日志。保留锁文件、完整迁移、静态资源、许可证及第三方声明。在服务器原生安装和构建，不上传Windows的`node_modules`或Prisma引擎。

## 切换前核实

1. 只读核对Nginx目标、监听端口、PM2工作目录、Node版本、实际数据库与上传路径，确认Khui历史用户数据归属。
2. 为新源码使用独立版本目录；不覆盖旧发布或共享数据。使用Node24，在新目录执行：

   ```sh
   npm ci
   npx prisma generate
   npm run verify:build
   ```

   `verify:build`在独立空库验证迁移和生产构建，不把共享生产库作为构建库。已有业务库的升级另用副本验证。
3. 从受保护备份恢复数据库与上传到全新隔离目录，关闭真实AI和支付，在备用本机端口验证登录、权限、素材和新写入；不让副本接入正式回调。
4. 确认维护窗口及应用、数据库、上传、密钥联合回退方案。备份仅留服务器，按用户决定不下载本机。

## 正式发布

先停止本项目全部业务写入、上传清理及其他写任务，再创建数据库与上传联合备份。后台“业务只读维护”只拦截新业务提交，不阻止已开始请求、管理写入或结算，因此不能替代完整停写。

在已确认的Khui共享环境下执行`npm run state:backup -- <唯一标签>`；检查清单、完整性、外键和文件校验。仅在备份成功且源库已核实时，在新发布目录执行`npx prisma migrate deploy`。正式升级不执行`db:init`、`db push`或reset；产品初始化种子不作为已有库的发布步骤。

启动前必须从新发布目录执行 `npm run release:check -- /www/wwwroot/khui-ai/shared/database.db`，PM2实际配置与`npm start`已在Next.js启动前自动执行同一检查，线上入口已切换并验证，仅退出码0时继续。它只读核对迁移名称，拒绝待应用、未完成和数据库独有迁移；不能仅凭Prisma migrate status成功判断旧代码兼容。检查通过仍需副本业务验收。当前39迁移的commercial-20261014-1250不得作为44迁移商业后台的直接回退目标，其CMS页面图片读取已在隔离验收返回404。

按 [ecosystem.config.js](ecosystem.config.js) 启动新版本；跨发布目录时不能仅依赖startOrReload，必须检查实际pm_cwd。若它仍指旧目录，仅在停写、备份及副本验收后重建独立PM2中的khui-ai条目，并保留旧版本供恢复。模板从自身位置解析发布目录，进程名称为`khui-ai`，单实例、www身份、仅监听`127.0.0.1:3000`。先确认端口实际归属，不直接覆盖现有服务。模板默认禁止模拟AI和模拟充值，真实支付及环境成本熔断关闭；后续启用真实业务时同时核对PM2环境与后台数据库配置。

PM2命令必须使用本项目独立环境：

```sh
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 list
```

确认新实例验收通过后再保存该PM2进程列表。`khui-ai-pm2.service`管理的是这一独立PM2目录，不能直接操作root或其他应用的PM2实例。Node与PM2可执行路径须按服务器实际安装核对。

## Nginx、健康检查与证书

将 [nginx-location.conf](nginx-location.conf) 合并到该域名现有HTTPS配置，处理重复root location，保留宝塔证书与ACME验证路径。先`nginx -t`再重载。SSE关闭代理缓冲和缓存；上传始终经过Next权限检查，不配置直接读取上传目录的Nginx规则。

切换后验证HTTPS、登录、中文导航、后台权限、上传授权、聊天失败边界及支付关闭状态；关闭真实模型时聊天503是预期，不能以模拟回复替代真实验收。

`khui-ai-health.service`模板仍指向`/www/wwwroot/khui-ai/app/scripts/check-site-health.mjs`；启用前将WorkingDirectory与ExecStart明确改为本次实际发布路径，或核实原app目录仍是受维护入口。不能因旧脚本仍存在就认为它对应当前版本。健康脚本只读检查HTTPS与公开角色查询，不记录响应正文或密钥。

安装或更新本项目systemd单元前用`systemd-analyze verify`检查；五分钟健康timer需要分别确认enabled/active、实际定时触发和journal结果。日志检查与外部告警送达分开验收，当前没有已授权的外部通知渠道。已有证书签发不代表自动续签已通过；后台证书检查只观察，不执行签发或续签。

## 回退与恢复

保留上一发布、联合备份及对应配置。数据迁移后不能只切回旧代码并宣称完成业务回滚。需要恢复时先停写，使用`state:restore`恢复到全新目录，核验应用版本与迁移历史，再一起切换数据库、上传和配置；不覆盖源库或源备份。

若切换后已有新写入，先保存现状及恢复来源，再人工核对新增数据，禁止直接回到旧库丢弃这些记录。完整服务器回滚、HTTPS续签、真实AI/支付及用户灰度仍需现场验收，本地测试不能替代。
