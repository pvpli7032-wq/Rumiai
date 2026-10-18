# 执行中发现的问题与未做项

本文件记录执行 AI 在改造过程中发现的问题、核实结论与未执行项。新增条目追加在末尾，已解决条目保留并标注状态。

## 基线（阶段 0，2026-10-18）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 分支 | `git checkout -b commercial-refactor` | 从 develop 建立，工作树已对齐线上发布目录 |
| 类型检查 | `npx tsc --noEmit` | 通过，无输出 |
| 管理权限测试 | `npm run test:admin:access` | 3 通过 / 0 失败 |
| 生产构建 | `ISOLATED_BUILD_DIR=.temp/validation-build npm run verify:build` | 通过，116 页 |

说明：`npm run build` 直接运行会因缺少 `DATABASE_URL` 在预渲染 `/[locale]/explore` 时失败，这不是代码缺陷；项目自带 `verify:build` 会创建一次性隔离库再构建。基线以 `verify:build` 为准。

## 线上环境事实（只读盘点，2026-10-18）

| 项 | 事实 |
| --- | --- |
| 服务器 | Rocky Linux 9.2，内核 5.14，Node 24.14.1，npm 11.11.0，PM2 6.0.14 |
| 发布目录 | `/www/wwwroot/khui-ai/releases/payment-amount-20261017`（当前运行版本） |
| 持久目录 | `/www/wwwroot/khui-ai/shared/`（`app.env`、`database.db`、`uploads`、`pm2`） |
| 进程 | systemd `khui-ai-pm2.service` active/enabled，PM2 应用名 `khui-ai`，监听 `127.0.0.1:3000` |
| 反向代理 | Nginx `html_lh.y-98.cn.conf`：443 证书 Let's Encrypt（有效至 2027-01-11），`location ^~ /` 代理到 3000 |
| 数据库 | SQLite，74 张表，46 条迁移 |
| 规模 | 45 个 page.tsx、126 个 API route、23 个 lib 域目录、67 个测试、56 个脚本 |
| 版本一致性 | 线上 `src/` 与本地工作树 diff 仅 1 个文件：线上多 `src/lib/operations/migration-status.ts` |

## 已核实并推翻的建议书条目

| 建议书位置 | 建议书结论 | 实测结论 | 处理 |
| --- | --- | --- | --- |
| 4.4 `public/brand/persona-0..5.svg` | “全项目检索未发现对这些文件名的引用，确认无引用后删除” | **有引用**：`prisma/seed.ts` 与 `prisma/seed-community.ts` 用 `/brand/persona-${i}.svg` 作为种子角色头像，`scripts/verify-m2-chat.mjs`、`scripts/verify-m3-circles.mjs` 也引用 | 保留，不删除 |
| 4.4 `next.config.mjs` 的 `api.dicebear.com` | “全项目没有任何代码引用，删除该条 remotePatterns” | 源码确实无引用，但 `.next-build/`、`.next-validation-build/` 的构建产物里仍有该白名单条目，属配置残留 | 按建议删除，需重新构建确认 |

## 未执行项

（暂无）
