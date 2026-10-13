# 星伴 · AI 角色社区

基于 Khui AI 的 MIT 源码维护。技术栈：Next.js 15、React 19、TypeScript、Prisma 5、SQLite、Tailwind 4。保留原始[许可](LICENSE)及[第三方声明](THIRD_PARTY_NOTICES.md)。支持 Safari 16.4、Chrome 111、Firefox 128 及更新浏览器。

## 本地开发

推荐 Node.js 24。复制 `.env.example` 为 `.env`，设置数据库地址和至少32字符的随机 `JWT_SECRET`。真实模型及支付按需配置。

```powershell
npm ci
npm run db:init
npm run dev
```

打开 http://localhost:3000/discover。初始化应用有序迁移并补充默认内容，不清空已有数据。数据库相对路径以 `prisma` 目录解析；保留全部迁移，不使用 reset 或 db push 替代。

```powershell
npm run build
npm start -- --hostname 127.0.0.1 --port 18781
```

开发构建为 `.next`，生产构建为 `.next-build`；直接调用 Next CLI 时指定 `NEXT_DIST_DIR=.next-build`。环境密钥、数据库、上传、备份、依赖和 `artifacts` 不提交到 Git。

## 业务模块

- 用户：登录、资料、关系、本人数据导出与密码确认注销。
- 角色与社区：创作、审核、发现、收藏、圈子、帖子、评论、举报及申诉。
- AI与会话：模型白名单、流式回复、超时和重试、调用额度、用量及成本、可选预算熔断。
- 金币与支付：充值价格快照、幂等入账、套餐和赠币活动、整单退款、财务核对。
- 管理后台：独立桌面布局，审核、财务、管理人员、角色权限和操作审计。

后台入口为 `/admin`。注册后在服务器显式指定首位所有者：

```powershell
npm run admin:bootstrap -- admin@example.com
```

命令只接受已注册账号，不创建密码或自动提升首个注册用户。系统角色包含所有者、审核管理员、财务查看员、财务管理员和管理审计员；可通过后台分配身份及自定义角色。当前CM01新增代码已在本地实现，线上部署状态见[任务清单](docs/待完成清单.md)。

模拟AI和模拟购买只允许显式开启的开发环境。生产缺少配置时返回不可用。充值基础三档为6元60、10元100、30元300金币，后台支持活动赠送；聊天免费次数和扣币价等待运营确认，尚未启用。成本未知不能视为零；真实商户、模型、真机和用户灰度验收仍需完成。

## 验证

```powershell
npm run typecheck
npm run test:admin:access
npm run test:admin:management
npm run test:m4:ezfp
npm run test:m5:export
npm run test:m5:closure
npm run test:admin:management:browser
```

支付测试使用生成的本地密钥、模拟渠道和隔离数据库；后台浏览器检查自行启动隔离服务，关闭真实模型和支付。浏览器需先安装 Playwright Chromium。`npm test` 及真实AI验证会写入或调用外部服务，使用条件见[部署说明](DEPLOYMENT.md)。

## 维护资料

- [架构与目录](ARCHITECTURE.md)、[维护规则](AGENTS.md)、[安全说明](SECURITY.md)。
- [部署与备份](DEPLOYMENT.md)，[宝塔配置](deploy/baota/README.md)。
- [商业后台实施方案](docs/商业运营后台实施方案.md)、[任务清单](docs/待完成清单.md)、[原计划书](docs/项目实施计划书_v1.0.docx)。
- [财务与充值](docs/finance/财务与充值.md)、[收费方案](docs/finance/收费方案草案.md)、[账户隐私](docs/accounts/账户隐私.md)、[内容来源](docs/content/内容来源登记.md)。
