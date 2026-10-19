---
name: run-e2e
description: 在明确隔离的本机服务上运行 HTTP/SSE 集成和浏览器检查。
---

# 运行集成检查

先确认 TEST_BASE_URL 对应隔离服务，服务在同一进程显式配置隔离 DATABASE_URL，真实 AI/支付关闭。不要默认使用已有 localhost:3000：测试会创建账号、角色和交易。隔离运行要求见 README.md，具体脚本要求也见 README.md。

npm test 使用 tests/runner.ts 运行四组 HTTP/SSE 检查：功能、边界、跨功能和用户流程。浏览器检查需要已安装 Playwright Chromium；安装与执行共享 PLAYWRIGHT_BROWSERS_PATH。

先读失败输出；全文件失败时先检查服务和端口，不能据此更改断言。签到/任务幂等冲突可能来自测试库旧状态；不得 reset 用户数据库，也不能把模拟成功当真实 AI/支付验收。
