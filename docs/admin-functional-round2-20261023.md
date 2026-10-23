# 后台功能 Round 2 发布与验收记录

日期：2026-10-23（本机时间，Asia/Shanghai）

本报告与修复源码一同提交，仓库版本以包含本文的提交为准。正式 Admin V7 已切换；API 仍使用 `ISWpxlzQNoA4ojMoubMil`，未重建或替换 API 产物。

## 切换前证据（进程已回收）

- 候选 release：`membership-candidate-20261023`
- Admin 临时 listener：`127.0.0.1:3111`，PID `104228`，用户 `www`（UID 1000）
- 进程 cwd：`/www/wwwroot/khui-ai/releases/membership-candidate-20261023/apps/admin`
- `NEXT_DIST_DIR=.next-round2-hotfix3-20261023`
- Admin build：`V7AAo8K0n4HOiZEppq02D`
- API build：`ISWpxlzQNoA4ojMoubMil`
- V7 专属 manifest 返回 HTTP 200；旧 Q9/4eSw manifest 返回 HTTP 404
- 本机隧道仅为 `localhost:3111 -> 127.0.0.1:3111`，未触碰正式 PM2

## 本轮实际修复与有效检查

- AI 预检：删除前按钮打开 fresh GET 预检；展示具体阻止原因与引导，失败可重试/取消后重新打开，并支持 `providerId` 过滤；编辑使用既有新鲜回填逻辑。没有执行真实 AI 请求。
- 角色与草稿：补齐未分配自定义管理角色 DELETE，以及站点从未发布、无引用 DRAFT DELETE；系统角色无 UI 删除入口，保留业务引用与历史，不新增“归档”语义。
- 导航与设置：统一 7 域、25 个主入口、47 个可定位叶子；设置支持完整 section 落点、history back/forward、脏草稿确认；侧栏持久化区分手动收起与跨分支自动展开。
- 有效检查：服务器 `typecheck` 通过；架构边界检查 854 项通过；导航 unit 5/5；服务行为检查 9/9；V7 focused 导航 6/6。
- 生命周期边界：`live-lifecycle.json` 的 UI 实操在正式数据库上只创建并删除本轮自有的 6 批临时配置（inactive provider/model、未分配自定义角色、站点未发布草稿等），清理后 0 残留；另有隔离 SQLite fixture 专门证明系统角色 API 拒绝。未删除已有角色/用户、历史订单、真实支付/退款数据。

### 会员 guard

脚本：`.temp/admin-round2/deletion/verify-membership-guard.mjs`

报告：`artifacts/admin-functional-round2/candidate-membership-guard.json`

会员 guard 使用 Q9 前候选报告由会员 owner 独立维护；本次只改 Admin 导航文件，guard 逻辑未变，因此复用该 3/3 证据。tab 切换、取消离开保留草稿、确认离开并回载原值三项通过；0 blocked business writes、0 errors。未保存会员设置，未发起订单、支付、退款或 checkout 请求。

### 导航 state

脚本：`.temp/admin-round2/navigation/verify-live-state.mjs`

报告：`artifacts/admin-functional-round2/nav-state-summary.json`

V7 focused 6/6 与持久化导航回归已通过，证据为 `artifacts/admin-functional-round2/persisted-v7-nav-owner/nav-state-summary.json`；本轮 hotfix3 实际点击剩余 11 leaf 也全部通过：settings 5、tasks 1、operations 3、operators 1、audit 1。所有点击均校验 URL、active leaf 和展开状态；0 blocked/unexpected writes、0 browser/http errors。

实际点击报告：`artifacts/admin-functional-round2/q9-remaining-11-real-clicks.json`。

旧 alias 只读检查：`/admin/finance?tab=invalidtab` 规范到 `/admin/finance`，订单 tab 选中，无浏览器/HTTP 错误。

## 源码同步准备

服务器 current 中 union 后共 31 个候选源码文件，另含本轮导航验收脚本。每个文件的 server SHA-256、hotfix3 dist 信息和排除项见：

`artifacts/admin-functional-round2/final-server-source-manifest-20261023.json`

同步时排除 `.env*`、`shared/database.db`、`uploads/`、密钥、`.next*/`、`node_modules/` 以及服务器自动生成的 tsconfig include 噪声。31 个文件已按清单同步到本机并逐项 SHA 核对为 0 mismatch；本地独立 `tests/e2e/admin-navigation-focused.mjs` 与 docs 保留。正式切换结果见下节。

## 正式 Admin V7 切换结果

- 停止并回收候选 listener `104228`；旧 formal `.next-admin` 保存在 `/www/wwwroot/khui-ai/current/apps/admin/.next-admin-formal-before-v7-20261023`。
- formal `.next-admin` 以相对链接指向 `.next-round2-hotfix3-20261023`，BUILD_ID 为 `V7AAo8K0n4HOiZEppq02D`。
- 专用 PM2 `khui-ai` 已重启；PID `105342` 在线，API/Admin/Web/worker 子进程恢复。实际端口为 `3012/3011/3000`；3010 未监听，因为当前 PM2 `WEB_PORT=3000`。
- 四个 PM2 进程环境均核对 `EZFP_ENABLED=false`、`EZFP_REFUNDS_ENABLED=false`；checkout policy `enabled=false`、version `3`。
- HTTPS `/admin` 返回 200；实际 Admin 静态资源 `/admin-assets/_next/static/V7AAo8K0n4HOiZEppq02D/_buildManifest.js` 返回 200，旧 Q9 资源返回 404。登录态设置页、侧栏到运行状态点击、AI 模型删除前 GET 预检均通过，0 非 GET 写入、0 浏览器/HTTP 错误。证据：`artifacts/admin-functional-round2/live-v7-postcutover.json`。
- 稳定桌面截图已由 root 复核符合预期；导航 owner 的稳定截图与 focused 报告在 `artifacts/admin-functional-round2/persisted-v7-nav-owner/`。
- 正式部署汇总见 `artifacts/admin-functional-round2/final-v7-deployment.json`；临时 session 已撤销，本次 SSH 隧道与候选 listener 已停止。

## 剩余导航 leaf 与视觉验收

此前直接 goto 的 HTTP 诊断曾发现持久化状态时序问题，属于旧候选材料，不作为最终 PASS 证据。hotfix3 已按用户路径真实点击复验，报告见 `q9-remaining-11-real-clicks.json`。

旧 alias `/admin/finance?tab=merchants` → `/admin/payments/merchants`、未知 tab → `/admin/finance` 均为 HTTP 200。390x844 移动端与 1440x1000 桌面端结构化检查无横向溢出；稳定桌面截图已由 root 复核通过，导航 owner 稳定截图目录为 `artifacts/admin-functional-round2/persisted-v7-nav-owner/`。

## 未覆盖边界

- 既有前 36 个导航 leaf 的历史只读证据仅在未改动业务源码边界内复用；剩余 11 个 leaf 已在 hotfix3 真实点击通过。V7 稳定截图与 focused 回归已完成。
- 真实收款、真实退款、真实 AI 调用、已有业务数据删除均未执行。
- 临时 session、SSH 隧道和候选 listener 已按本次对象回收；正式 PM2 与 rollback 目录保留。
