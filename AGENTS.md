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

## 网页优先与未来 App 兼容要求（强制）

- 当前交付目标是网页端与移动浏览器体验。未来 App 兼容仅约束本次新增或修改代码的写法，不自动授权全站重构、目录迁移、建立 App 工程或开发原生功能。
- 继续沿用现有应用与模块归属。不得以“以后打包 App”为由新建 `apps/mobile`、`android`、`ios`、平行客户端、预留适配包或空接口；不得提前安装打包框架、原生插件或另写计划书。具体打包方式在用户实际提出 App 开发需求后再确定。
- 前端新增或修改的接口请求优先复用现有 `apps/web/src/lib/api-client.ts`，保留流式、上传等必要专用请求的现有归属；接口来源、资源地址和平台相关请求差异集中在已有请求或资源入口处理，不在业务组件里硬编码服务器域名、内网地址或本机端口。保持现有网页同源代理可用，不为假设中的 App 随意放宽跨域权限。
- 登录、权限、角色访问、聊天生成、金币、会员和订单等权威规则始终由 API 与后端模块执行，未来客户端复用同一套服务。前端不得直连数据库或把服务端实现、供应商密钥、数据库凭据打入浏览器或未来 App 包；共享包仍遵守现有依赖方向。
- 公开请求、响应、错误码和请求状态沿用现有 contracts 与 API 约定，不让客户端依赖数据库内部结构、服务器文件路径或特定页面 DOM。改变已被使用的接口时，在本次改动内处理兼容或同步更新调用方；不得因此预建另一套 API、版本目录或协议。
- 浏览器专用能力（登录令牌存取、文件选择、录音、朗读、通知、剪贴板、页面可见性等）优先沿用现有封装，业务组件调用其明确入口；已有封装可承接时不另建适配层。与页面无关的业务规则、共享契约不得依赖 `window`、`document`、`localStorage` 或原生插件。仅在真实需求出现时增加必要的平台适配，不创建猜测性的接口、工厂或占位实现。
- 登录状态和会话有效性以服务端为准，令牌存储细节留在现有认证入口。处理过期、退出登录和权限失效时使用一致的响应与清理规则，为未来替换客户端存储方式保留明确边界，不提前接入原生存储 SDK。
- 新增或修改聊天发送、重试、流式和恢复代码时，沿用既有 requestId、状态查询、取消与计费规则。弱网、刷新、切后台再返回时先核对原请求结果，不因连接中断或页面恢复自动重复生成、重复扣费；后台运行是否继续、何时取消必须遵守已有明确策略。不得把一条 SSE 连接仍存在当作请求状态的唯一依据。
- 网页功能同时照顾移动浏览器：键盘弹出、可视高度、安全区、长列表滚动、返回导航、触摸操作，以及图片和录音权限拒绝后的提示与恢复。按本次受影响页面验证，不为设备适配复制整套业务页面或修改无关目录。
- 保留现有 Next.js 服务端渲染、路由与代理的实际职责，不为未来封装强制全站静态导出或移除服务端功能。维护现有 PWA 时，私聊、账号、订单及带认证的 API 响应不得被通用离线缓存规则缓存；离线提示不得伪装成聊天已发送或交易已完成。
