# 后台独立浏览器验收

`tests/e2e/admin-browser.mjs` 使用 Playwright 访问独立 admin 服务，默认地址 `http://127.0.0.1:3011`。

当前脚本覆盖：

- 未登录访问 `/admin` 跳转 `/admin/login`；
- 登录页输出 `/admin-assets` 静态资源；
- 静态资源实际返回 JavaScript 200，而不是 HTML 回退。

隔离工作流脚本 `tests/e2e/admin-live-workflows.mjs` 进一步验证了：

- admin 独立登录；
- 普通用户使用正确密码请求后台登录仍被拒绝（403）；
- 后台 Cookie 单独请求前台 `/api/users/me` 仍为 401，前台登录不会获得 admin session；
- 侧栏收起状态写入 localStorage 并在刷新后保持；
- 后台用户详情中的“昵称 + 操作理由”真实表单保存成功，并在详情审计记录中可见；
- 表单保存后的用户资料由前台 `/api/users/me` 读取，并在前台 `/profile` 页面实际渲染；
- 后台写入月会员套餐后，前台 `/api/memberships` 能读到价格和权益；
- 前台登录不会获得 admin session。

会员套餐还通过后台会员页面的真实表单改价并点击“保存配置”，随后再次从前台接口读取确认新价格。所有测试均使用临时 SQLite，不使用线上数据库。

最终执行：`npm run test:e2e:admin`，基于 Next.js 15.5.28 的三个最新生产构建，退出码为 0。

本轮财务会员抽屉验收同样通过：在隔离 SQLite 中由真实会员领域创建两笔已确认会员订单（非商户实付），分别准备已使用退款 2900 分与未使用退款 3000 分。后台财务订单列表点击会员订单后，抽屉实际显示 29.00 元退款和真实 `MembershipRefund.id` / 渠道退款号；会员订单不显示金币整单退款、金币审批或渠道重试动作，仅提示按会员权益规则由会员中心处理。结果标记为 `membershipFinanceDrawerRefund=true`、`membershipFinanceNoCoinActions=true`。

本轮命令：`npm run test:e2e:admin`，结果为 0；测试结束后 3010、3011、3012 均已确认释放，临时浏览器、服务进程、SQLite、上传和备份目录均由 finally 清理。支付和退款实际开关保持关闭。

增强后的断言还包括前台会员页面实际渲染 `¥1.23`、首页和探索页及其 API 投影返回 200、运维报告迁移检查返回 200 且无待应用迁移、后台 Cookie 与前台认证互不冒用。前台 Bearer token 访问后台 session 仍返回 401。

脚本使用本机隔离数据，先断开种子连接；所有步骤用 finally 收尾，关闭浏览器、等待测试子进程退出，再删除临时数据库。测试支付和退款总开关均关闭，上传与备份目录同样指向临时目录。不得改为线上数据库。

## 已购会员前台工作流

`tests/e2e/membership-paid-workflows.mjs` 使用同一套临时 SQLite fixture，但订单由真实会员领域 `createMembershipOrder` / `markMembershipPaid` 创建；续费订单按当前有效期衔接。另用真实 billing `holdCharge` / `settleCharge` 产生一条已消费权益，因此退款试算分别验证未使用全退（3000 分）与使用后扣一个 24 小时周期（扣 100 分，退 2900 分）。

浏览器验收覆盖当前会员、含续费有效期、订单列表、手动续费入口、退款金额确认弹窗；取消确认不会发送退款 POST。退款开关保持关闭时，确认退款请求实际返回 `503 / REFUNDS_DISABLED`，前台显示失败且会员权益和订单仍保持有效。测试使用隔离测试商户快照和真实 RSA 测试密钥，不调用真实商户。
