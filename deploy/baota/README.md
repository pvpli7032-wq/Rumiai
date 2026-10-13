# 宝塔部署：lh.y-98.cn

此目录为待服务器环境核实后的配置，尚未在服务器执行。使用 Linux Node 24，单进程运行；确认 3000 端口未被其他项目占用。只上传源码，在 Linux 安装依赖、生成 Prisma Client 和构建，不上传 Windows 的 node_modules、构建缓存或测试数据库。

## 当前连接验收状态

2026-10-13 本机检查：SSH TCP 连接建立后在认证前关闭；宝塔端口的 Windows TLS 握手失败，Node TLS 也返回 ECONNRESET，没有提交登录密码、没有修改服务器。本机 DNS 将域名解析为 198.18.0.162，可能使用代理虚拟 DNS，不能据此判断域名的公网解析或服务器防火墙。需要从服务器控制台或可正常访问面板的环境核实系统、访问限制和实际站点，再执行下述步骤。

## 安装与启动

建议代码目录 `/www/wwwroot/khui-ai/app`，持久数据目录 `/www/wwwroot/khui-ai/shared`。部署前核实目录是否存在并保留现有站点、数据库、上传及配置。新项目的 `.env` 设置：

```dotenv
DATABASE_URL="file:/www/wwwroot/khui-ai/shared/database.db"
UPLOADS_DIRECTORY="/www/wwwroot/khui-ai/shared/uploads"
NEXT_PUBLIC_SITE_URL="https://lh.y-98.cn"
```

从 `.env.example` 补齐其他配置，JWT_SECRET 在服务器生成，不写入版本库。文件仅限运行账号读取；真实 AI 和支付配置等待确认，不启用模拟付费或模拟聊天。此 PM2 配置关闭真实支付和成本熔断，后续启用时必须同步调整 PM2 环境，避免覆盖 `.env`。

在项目目录、已选定 Node 24 的环境中执行：

```sh
npm ci
npm run db:init
npm run build
pm2 start deploy/baota/ecosystem.config.js
```

已有数据库必须先完成数据库及上传的联合备份，再执行迁移；不能使用 reset 或覆盖旧库。上述初始化不重置数据库，但会应用迁移和种子内容。确认 PM2 使用所选 Node 24，避免宝塔和命令行重复管理同一进程。

将 `nginx-location.conf` 合并到该域名的现有 HTTPS server 配置，保留证书和 ACME 验证路径，处理原有重复 root location。上传文件必须经过 Next 的权限检查，不能另外配置 Nginx 直接读取 public/uploads 或 shared/uploads。检查 `nginx -t` 成功后再重载该站点配置。

验收 HTTPS、注册登录、上传访问权限、聊天流式响应与管理页；真实模型尚未配置时聊天不可用是预期状态。确认无误再保存 PM2 进程配置并按服务器现有开机方式配置启动。监控、异地备份和实际回滚仍需服务器验收。

升级或回滚前停止业务写入和清理任务，运行 `npm run state:backup -- <唯一标签>`，保护备份并保存异地副本。恢复用 `state:restore` 创建新目录，同时切换数据库和上传路径、轮换 JWT_SECRET。备份后的新增数据必须单独保存核对，不通过切回旧库丢弃。
