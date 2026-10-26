# Repository working rules

## Environment boundary (mandatory)

- All inspection, development, debugging, tests, Git operations, releases, and deployments for this repository must run only in an approved cloud workspace, GitHub workflow, or the explicitly authorized online BaoTa project.
- Never access, read, modify, execute, or use a fallback copy from the user's local computer, local IDE, local filesystem, or local sessions.
- A cloud task does not by itself authorize pushing, merging, deploying, production database access, paid-provider calls, or production writes. Those actions still require the user's explicit authorization for the specific operation.
- If the approved cloud environment is unavailable, stop and report the blocker. Do not work around it with a local copy.

## Commercial safety

- Do not invent prices, commission rates, benefits, refund promises, or payout rules. Unconfigured commercial features must stay disabled and fail visibly.
- Use isolated fixtures for state-changing tests unless the user explicitly authorizes a named online test target. Never delete real production users or make real payments during verification.

## 代码位置与新建文件要求（强制）

### 修改前先确定归属

- 开始写代码前，先读 `docs/architecture.md`、`docs/domain-boundaries.md`，并检索同一业务已有的页面、路由、服务、类型和测试。先读已有实现，再决定修改位置；不得凭目录名猜测后直接新建。
- 每项改动必须归属一个明确的业务模块。同一业务的界面、规则和数据契约沿用各层既有位置；不得因为某个文件或文件夹空着、容易找到或代码容易插入，就把无关逻辑放进去。
- 默认扩展已有模块、已有目录和已有合适文件。文件确实承担不同职责、需要独立维护，或框架要求单独入口时才新建；既不能为每个小函数单独建文件，也不能把无关业务追加到现有大文件。
- 如果现有模块都不适合承接，先在本次回复中简要说明新模块的职责、为什么不能放入现有模块、拟建路径和调用入口，再按本次任务范围实施。不得为了猜测未来需求预建目录、空文件或整套分层骨架；不要求为此额外新建计划书。

### 代码必须放在对应位置

| 代码职责 | 允许归属 |
| --- | --- |
| 用户页面、布局和框架入口 | `apps/web/src/app` 中对应路由 |
| 用户业务组件及其专用 Hook | `apps/web/src/components/<已有业务目录>`，优先与调用组件就近放置 |
| 管理后台页面与业务组件 | `apps/admin/src/app` 和 `apps/admin/src/components/<已有业务目录>` |
| 应用内通用的客户端适配或 Hook | 对应应用现有 `src/lib` 子目录；业务规则仍归业务模块 |
| HTTP 鉴权、请求解析和响应映射 | `apps/api/src/app/api/<对应资源路由>`；业务规则调用后端服务 |
| 业务规则、读写服务和领域校验 | `packages/backend/src/modules/<所属业务模块>` |
| 跨多个业务模块的流程编排 | `packages/backend/src/workflows`；单模块内部流程留在原模块 |
| 数据库、日志、邮件等基础适配 | `packages/backend/src/infrastructure/<对应能力>` |
| 前后台与 API 共享的公开契约 | `packages/contracts/src/<对应业务目录>`；不放数据库或服务端实现 |
| 多应用实际共用的无业务基础 UI | `packages/ui/src`；单一业务组件留在所属应用 |
| 模型、迁移、版本化故事内容 | 分别放入既有 `database`、`database/migrations`、`content` |
| 后台进程入口、运维工具、测试 | 分别放入既有 `apps/worker`、`ops`、`tests` 对应分类；任务业务处理沿用后端任务注册和领域服务 |

- 依赖沿既有方向使用：界面通过 API 访问业务；包不反向导入应用；模块间调用明确的服务入口。不得为了就近调用而复制另一模块的代码，或把同一规则分别写进页面、API 路由和后端。
- 具体命名、层级和文件拆分遵循同目录现有约定；不要擅自给已有业务另起同义模块，或插入一套平行的 `features`、`services`、`core`、`common` 等目录体系。

### 新文件和新目录必须有实际用途

- 新建前必须确认现有文件无法合理承接，也没有可复用的实现。每个新文件都要能说明“所属模块、单一职责、实际调用方或执行入口”；框架入口、迁移、测试和资源文件说明其被发现或消费的方式。
- 新目录只在现有业务边界内按真实职责建立。新增顶层目录、应用、共享包或独立后端模块时，必须有本次需求对应的独立责任，且同步维护已有架构文档中的归属；不得仅为目录整齐、套模板或预留扩展而创建。
- 共享抽取以真实复用为依据。只有一个使用位置的业务代码优先留在该业务目录；有至少两个真实消费者、职责一致时再考虑抽取。不得把带业务规则的代码塞进 `utils`、`helpers`、`lib`、共享 UI 或 contracts 来规避模块归属。
- 保持一个业务能力的权威实现。不得用 `new`、`v2`、`final`、`backup`、`temp`、`copy` 等文件或平行目录绕开已有实现；确有兼容或版本协议需求时，须说明边界及实际调用关系。
- 修改需求默认更新既有文档和工具。未经本次任务需要，不新增计划书、总结报告、重复 README、临时验证脚本、备用配置或独立脚手架；必要的临时产物使用批准环境已有的忽略目录，不进入源码树。
- 完成前逐项检查本次新增的文件和目录：归属正确、职责必要、入口真实、没有重复实现、没有无关改动。删除本次留下的空文件、未使用骨架和临时产物；最终回复简要说明新增文件的用途，没有新增则如实说明。
