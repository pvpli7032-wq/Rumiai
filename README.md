# 星伴 AI 角色陪伴社区

一个仓库维护用户前台、独立后台、HTTP API 和后台任务。界面通过既有 API 读取真实角色、社区、会员与账户数据；业务规则由后端模块维护。

## 维护入口

- [项目结构与模块归属](docs/architecture.md)：目录责任、依赖方向、前后台边界。
- [运行、验证与发布](docs/runbook.md)：批准环境、隔离测试、持久数据、发布和 Git 同步。
- [业务模块边界](docs/domain-boundaries.md)：账号、邀请、增长、计费、会员及消息媒体的已有能力和未实现边界。
- [工作规则](AGENTS.md)：本项目的环境和操作授权约束。

## 目录

| 位置 | 责任 |
| --- | --- |
| apps/web、apps/admin | 用户前台、后台界面 |
| apps/api、apps/worker | HTTP 入口、唯一后台任务执行入口 |
| packages/backend | 业务模块、工作流和基础设施 |
| packages/contracts、packages/ui | 跨应用契约、无业务基础组件 |
| database、content | 模型与迁移、随版本发布的故事内容 |
| ops、tests | 运行维护工具、单元/隔离集成/浏览器检查 |

开发、调试和验证只在已批准的云环境或指定宝塔服务器工作区进行。Node.js 要求见 package.json 的 engines；依赖以 package-lock.json 为准。首次配置和启动按运行手册操作。

常用检查入口为 npm run architecture:check、npm run typecheck、npm run test:unit。更具体的行为检查按改动范围选用 package.json 中的领域测试；完整命令、环境与隔离要求见运行手册。

实时环境配置、数据库和上传文件存放于服务器 shared 持久目录，由实际运行配置指定，不放入 Git 或发布源码目录。根 .env.example 仅提供配置字段模板。路由清单与测试结果在运行时生成到被忽略的 artifacts/，历史轮次报告和部署快照不作为项目的当前状态入口。
