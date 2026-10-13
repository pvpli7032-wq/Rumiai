# 宝塔部署：lh.y-98.cn

此目录为 `lh.y-98.cn` 的部署配置。2026-10-13 已将 f9ebb04 源码部署到 Rocky Linux 9.2，使用服务器原有 Node 24.14.1，在 Linux 安装依赖、应用 16 条迁移、生成 Prisma Client 并完成生产构建。单进程以 www 运行，仅监听 127.0.0.1:3000；没有上传 Windows 的 node_modules、构建缓存或测试数据库。

## 当前连接验收状态

2026-10-13 本机检查：SSH TCP 连接建立后在认证前关闭；宝塔端口的 Windows TLS 握手失败，Node TLS 也返回 ECONNRESET，没有提交登录密码、没有修改服务器。本机 DNS 将域名解析为 198.18.0.162，可能使用代理虚拟 DNS，不能据此判断域名的公网解析或服务器防火墙。需要从服务器控制台或可正常访问面板的环境核实系统、访问限制和实际站点，再执行下述步骤。

用户关闭 TUN 后 SSH 登录成功，服务器域名解析为 43.242.194.115。现有站点文件保留，原 Nginx 配置备份在 `/www/wwwroot/khui-ai/shared/nginx-before-f9ebb04.conf`；只修改此域名配置。Nginx 检查通过后启用 HTTPS，服务器及用户本机均验证证书和 /discover 200，HTTP 301 跳转。证书由宝塔 ACME 模块签发，保存于 `/www/server/panel/vhost/letsencrypt/lh.y-98.cn`，到期时间为 2027-01-11 04:51:56 UTC；自动续签的实际执行仍需验收。

独立 systemd 单元 `khui-ai-pm2.service` 已 active/enabled，使用 www 和独立 `PM2_HOME=/www/wwwroot/khui-ai/shared/pm2`，未改动其他 PM2 实例。进程保存并成功通过该单元重新启动；没有重启整台服务器。真实 AI 和支付保持关闭。实际 HTTPS Chromium 6 组通过：注册登录、安全 Cookie、六页中文导航/390px、源码路径不暴露、本人导出、注销及旧令牌拒绝，合成账号已注销。首次创作页加载超时，服务托管稳定后相同检查重跑通过；未将失败记录当作成功证据。线上监控、异地备份与实际数据回滚仍须补齐。

## 健康检查

`scripts/check-site-health.mjs` 只读检查实际 HTTPS `/api/characters`，同时验证证书、Next 路由和公开角色数据库查询。10 秒超时；HTTP 非 200、数据不是数组或连接失败退出 1，日志只含状态与原因，不记录响应正文或密钥。本地 HTTP 模拟正常、503、异常数据及超时检查通过，实际 HTTPS 单次检查通过。

`khui-ai-health.service` / `khui-ai-health.timer` 提供独立 www 进程，每五分钟检查一次，记录到 systemd journal，不发送外部通知。先将脚本放到 app/scripts，再将两个单元复制到 `/etc/systemd/system/`，用 `systemd-analyze verify` 检查后执行 `systemctl daemon-reload`、`systemctl enable --now khui-ai-health.timer` 和 `systemctl start khui-ai-health.service`。查看 `journalctl -u khui-ai-health.service -n 20`、`systemctl list-timers khui-ai-health.timer`。服务器断网本身可能让同机日志不可达，该方案不替代异地探测或外部告警送达。

用户授权调整 FlClash 后，已保存独立于订阅内容的全局 DOMAIN/IP-CIDR DIRECT 规则，并切换规则模式、保留 TUN 开启。TUN 下实际 HTTPS 200 和 SSH 登录通过，原配置备份留在 FlClash 用户目录。随后健康检查单元在服务器 `systemd-analyze verify` 通过，timer enabled/active，手动首次执行 Result=success / ExecMainStatus=0，journal 记录 site_health_ok，list-timers 显示下一次自动检查时间；首次自动定时触发仍需观察。外部通知未配置。用户明确选择备份仅留服务器、不下载本机，异地备份保持待办。

## 应用安装步骤

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
runuser -u www -- env PM2_HOME=/www/wwwroot/khui-ai/shared/pm2 /usr/bin/pm2 start /www/wwwroot/khui-ai/app/deploy/baota/ecosystem.config.js
```

已有数据库必须先完成数据库及上传的联合备份，再执行迁移；不能使用 reset 或覆盖旧库。上述初始化不重置数据库，但会应用迁移和种子内容。确认 PM2 使用所选 Node 24，避免宝塔和命令行重复管理同一进程。

首次启动前为 www 准备可写的 shared/pm2、shared/uploads 和数据库目录；`.env` 由 www 持有且权限 600，shared 权限 700，构建输出 `.next-build` 由 www 持有以支持缓存写入。运行代码和 node_modules 不需要交给 www 修改。当前已安装的独立 systemd 单元模板见 `khui-ai-pm2.service`，日常使用 `systemctl start/stop/restart khui-ai-pm2.service`，查看进程时使用上述相同的 runuser 与 PM2_HOME，不能直接操作 root 的 PM2 实例。

将 `nginx-location.conf` 合并到该域名的现有 HTTPS server 配置，保留证书和 ACME 验证路径，处理原有重复 root location。上传文件必须经过 Next 的权限检查，不能另外配置 Nginx 直接读取 public/uploads 或 shared/uploads。检查 `nginx -t` 成功后再重载该站点配置。

验收 HTTPS、注册登录、上传访问权限、聊天流式响应与管理页；真实模型尚未配置时聊天不可用是预期状态。确认无误再保存 PM2 进程配置并按服务器现有开机方式配置启动。监控、异地备份和实际回滚仍需服务器验收。

升级或回滚前停止业务写入和清理任务，运行 `npm run state:backup -- <唯一标签>`，保护备份并保存异地副本。恢复用 `state:restore` 创建新目录，同时切换数据库和上传路径、轮换 JWT_SECRET。备份后的新增数据必须单独保存核对，不通过切回旧库丢弃。

2026-10-13 实际服务器演练：仅停止本项目服务，备份为 `app/prisma/backups/database-deployment-f9ebb04`，随后恢复生产服务，再恢复到 `shared/restore-drill-f9ebb04`。两份数据库完整性、外键、16 条迁移及各表计数一致；该时间点没有用户上传文件，文件流程另由 Linux 隔离测试覆盖。实际 Linux 预算/成本/联合恢复 27/27，日志保存在 shared 下。恢复副本没有切换为生产实例，不能将本次演练称为业务回滚或异地备份验收。
