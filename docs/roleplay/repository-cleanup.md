# 仓库清理记录

基线：7b14ab88d500837962132711f189570f40c3bd73；核对递归树1833项、1212个文件。清理仅在当前工作分支实施，合并前主分支不变；不触及线上数据库、上传、用户数据或服务器release。

## 删除与替代

|原路径|动作|依据/替代|
|---|---|---|
|docs/frontend-capability-audit-20261025.md|删除当前树中的旧长审计|混合多个历史基线、需求和上线日志；已提取244次表格记录为223个唯一旧ID，登记于capability-register；历史全文仍在Git固定提交|
|docs/roleplay/*|新增8份当前文档|按总登记、开发方案、数据、API、入口、验收、清理职责拆分；不继续新增日期版/最终版副本|
|README.md|补当前规划入口|统一维护入口|
|docs/architecture.md|更新文档维护规则|允许唯一当前阶段计划，历史通过Git；保留原分层|
|docs/domain-boundaries.md|修正过期媒体说明|源码已存在supportsVision/supportsTranscription、AUDIO和媒体任务；不能继续声称仅图片展示|
|docs/runbook.md|移除历史“本轮未改”描述，增加阶段验证入口|运行手册维护稳定操作要求，不充当旧轮次总结|
|content/内容来源登记.md|修正迁移后的路径与测试环境文字|prisma→database；public→apps/web/public；遵循AGENTS批准环境|

旧需求来源：[固定历史全文](https://github.com/pvpli7032-wq/Rumiai/blob/7b14ab88d500837962132711f189570f40c3bd73/docs/frontend-capability-audit-20261025.md)。如需还原，使用Git读取该提交的指定文件；不要复制回当前docs造成两套并行规格。

## 保留清单与理由

|目录/文件|保留依据|
|---|---|
|apps/web、admin、api、worker|四个实际应用入口，职责明确|
|packages/backend、contracts、ui|领域、契约、共享UI，架构检查消费|
|database/migrations|升级链必须保留；不能按“旧文件”删除|
|database/seed*.ts|package.json命令引用，隔离环境初始化用途|
|tests/helpers、unit、integration、e2e|测试脚本/验证入口引用，非生产import不代表无用|
|ops/runtime、scripts、architecture|启动、发布、备份及边界检查命令引用|
|content/stories及来源登记|版本内容与来源证据，不是缓存|
|AGENTS.md、LICENSE|工作规则与版权声明|
|根配置/lockfile、tailwind-legacy-colors.json|工程配置资产；无确证不可用前保留|

当前受跟踪树未发现可证实无用的构建输出、node_modules、临时备份或空业务目录。Git不跟踪真正空目录。因此本次不虚构“清理了若干废弃文件夹”，也不为整齐重排已经合理的业务目录。未跟踪文件、服务器上传和本地缓存不在远程树检查范围，不能据此断言它们不存在。

## 后续目录规则

新增文件必须在任务包列明归属与消费者；一个领域一份服务所有权。临时运行产物仍进被忽略的artifacts；不把报告、截图、数据库或打包源码提交到业务目录。清理先列引用和运行入口证据，再删除；删除目录需确认其中没有历史迁移、运行脚本、授权素材或用户数据。新测试按unit/integration/e2e分层，不放在任意空目录。

本次规划提交不改业务代码/数据库。后续执行P1-01a单独提交代码、回归测试与云端工作流，以便区分文档整理与实际行为变化。
