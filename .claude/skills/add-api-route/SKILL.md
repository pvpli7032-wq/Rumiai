---
name: add-api-route
description: 新增 API 时复用项目身份校验、业务域服务和 HTTP 响应规则。
---

# 新增 API

先阅读 AGENTS.md 和 ARCHITECTURE.md，再查找相邻路由及已有域服务。路由只验证 HTTP 输入、解析身份、调用服务和映射响应；业务权限、价格和写库事务归 src/lib 对应业务域，不复制到新路由。

模型变更配套有序迁移，先在隔离数据库验证，不 reset 既有数据库。查询响应明确选取公开字段，避免泄露密码、密钥或私有内容；错误使用 { error: string } 并经现有日志工具记录脱敏信息。保持已有 SSE wire format。

按改动运行类型检查和有意义的功能回归。npm test 会写数据，必须使用明确隔离的服务和数据库；启动方式见 README.md，测试必须使用明确隔离的服务和数据库。需要维护的新契约或配置写入现行 README/ARCHITECTURE，不另建阶段公告。
