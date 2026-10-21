# W08 阻塞档执行条件

> 本表只记录当前未自动执行的评测档，不产生通过结论。运行入口来自 tests/story-evaluation/runner.mjs：domain 与 model-simulated 已注册；model-real、load、browser、manual 尚未注册。本文不启动真实模型、浏览器或负载。

## Model-real

| 用例 | 为什么不能自动跑 | 授权/准备责任 | 授权后命令 | 最小可执行条件 |
|---|---|---|---|---|
| EV-A12-001 | 需要真实模型测量 6k–10k 输入、300–700 输出 token；模拟回复不能证明 token、延迟或费用边界。 | W08/模型平台负责人提供固定模型、脱敏模板、费用预算和结果留存规则；产品/财务批准预算。 | STORY_EVAL_ALLOW_REAL_MODEL=1 STORY_EVAL_REAL_MODEL_BUDGET_TOKENS=<上限> node scripts/verify-story-eval.mjs run --id=EV-A12-001（当前无 model-real 执行器，需先实现并注册）。 | 明确模型与区域、隔离库、预算上限、token/费用采集；禁止用 simulated 替代 real。 |

## Model-simulated：自动骨架可跑，语义人工复核

| 用例 | 为什么不能自动判分 | 授权/准备责任 | 授权后命令 | 最小可执行条件 |
|---|---|---|---|---|
| EV-A03-001 | 断流可见片段和未确认保存文案依赖浏览器状态，不是纯 domain。 | W03 提供断流 fixture、预期截图和 SSE 中断点；QA 确认文案。 | MATRIX_KEEP_ARTIFACTS=1 node scripts/run-browser-matrix.mjs <browser-script-path> | 固定断流点、mock SSE、桌面/窄屏 viewport、保存失败与恢复证据。 |
| EV-A03-003 | 取消生成的费用规则需与额度策略一致，模拟事件不能证明 UI/计费组合。 | W03/W06 提供取消 fixture 与额度基线；财务/产品确认规则。 | MATRIX_KEEP_ARTIFACTS=1 node scripts/run-browser-matrix.mjs <browser-script-path> | 可取消 mock、独立额度账户、请求/结算日志和截图。 |
| EV-A06-004 | 需判断新剧情是否避开旧后果；domain 只能证明失效数据不入上下文。 | 内容负责人提供事实对照及语义口径；W08 提供可复现 response。 | node scripts/verify-story-eval.mjs run --id=EV-A06-004（实现后） | 固定 response、历史编辑 fixture、人工判定记录。 |
| EV-A06-008 | 遵守修正事实是语义断言，关键词不足以证明。 | 内容负责人提供允许/禁止表达；W08 提供固定模拟路径。 | node scripts/verify-story-eval.mjs run --id=EV-A06-008（实现后） | 两条纠错路径、固定 seed/响应、人工双审或明确评分规则。 |
| EV-A12-003 | 结章/关键节点触发需调用轨迹和关键节点定义；adapter/口径未闭环。 | W08/后端提供状态提取 adapter、事件契约和 fixture；产品确认矩阵。 | node scripts/verify-story-eval.mjs run --id=EV-A12-003 | 可记录 operation 的模拟 adapter、普通/关键/结章三组 fixture。 |
| EV-A12-005 | 真实与模拟区分是报告流程审查，单次 domain 不能证明版本/原始数据/阈值齐全。 | W08 冻结报告模板；QA 审核原始产物。 | node scripts/verify-story-eval.mjs report --json 后人工检查 | 版本号、环境、预算、原始 JSON/日志和阈值齐全。 |
| EV-A10-001（部分） | 英文完整性还需真实页面、回退语义与人工可读性；browser 执行器未注册。 | i18n 负责人提供英文覆盖/缺失键策略；QA 页面复核。 | MATRIX_KEEP_ARTIFACTS=1 node scripts/run-browser-matrix.mjs <browser-script-path> | 英文与缺失键 fixture、桌面/手机截图、不显示 key。 |

## Browser / manual

| 用例 | 为什么不能自动跑 | 授权/准备责任 | 授权后命令 | 最小可执行条件 |
|---|---|---|---|---|
| EV-A01-003 | 3 秒首屏可读依赖真实 DOM、时序和视觉可读性。 | W03 提供构建产物、fixture、稳定 selector；QA 确认计时口径。 | npm run build；MATRIX_KEEP_ARTIFACTS=1 node scripts/run-browser-matrix.mjs <browser-script-path> | .next-build、隔离服务、桌面/窄屏 viewport、截图与加载计时。 |
| EV-A01-004 | 建议编辑、30 秒首条消息和不自动发送需要交互时序。 | W03/W08 提供 Playwright 流程及人工计时表。 | npm run build；MATRIX_KEEP_ARTIFACTS=1 node scripts/run-browser-matrix.mjs <browser-script-path> | 三建议 fixture、失败 fixture、30 秒计时、请求日志。 |
| EV-A01-005 | 结束页、真实片段、回原会话/下一章是页面导航和 DOM 断言。 | W03 提供结束页脚本及有效/无后续 fixture。 | npm run build；MATRIX_KEEP_ARTIFACTS=1 node scripts/run-browser-matrix.mjs <browser-script-path> | 有/无消息、有效/无下一章、桌面/窄屏和深链刷新证据。 |
| EV-A10-003 | 移动键盘、中文 IME、长文本粘贴需实机，桌面模拟不等价。 | W08/前端提供目标机型与输入法矩阵；QA 留截图/录屏。 | MATRIX_KEEP_ARTIFACTS=1 node scripts/run-browser-matrix.mjs <browser-script-path>；再按人工记录表实机执行 | 至少 iOS/Android 目标机、IME、键盘展开收起、长文本粘贴。 |

## Load / performance

| 用例 | 为什么不能自动跑 | 授权/准备责任 | 授权后命令 | 最小可执行条件 |
|---|---|---|---|---|
| EV-A11-001 | **功能部分已完成**：游标分页已实现（`readConversationMessagePage` + 路由按参数分流 + 聊天页"加载更早"），并有 `tests/conversation-message-pagination.test.mjs`（含 1 万条只取一页）与 `scripts/verify-chat-pagination-browser.mjs`（首屏一页、翻页、输入可用、390px 不溢出）双重覆盖。**仍缺的只是正式负载报告**：固定并发与持续时长下的 p50/p95、错误率。 | W08/运维提供同区压测环境与基线；产品确认阈值。 | node scripts/verify-story-eval.mjs run --id=EV-A11-001（load executor 注册后） | 压测环境、并发/持续时间、p50/p95/错误率采集。功能断言已由上述两个脚本承担。 |
| EV-A11-002 | p95≤300ms 是统计指标，单次功能断言无法证明。 | W08/运维提供同区环境、基线和采集器；产品确认阈值。 | 同上（load executor 注册后） | 至少 30 次预热+100 次有效请求、固定窗口、p50/p95、锁等待。 |
| EV-A11-003 | 20/50 并发生成属于负载实验，不能用 domain 替代。 | W08/后端提供可控模拟上游和并发环境。 | 同上（load executor 注册后） | 20/50 并发各一轮、固定延迟/错误分布、消息/锁指标。 |
| EV-A11-004 | p50/p95、内存、锁、连接和费用需持续采样报告。 | W08/运维提供采集器和费用 fixture；财务确认口径。 | 同上（load executor 注册后） | 固定负载、采样窗口、资源基线、费用字段。 |
| EV-A09-002（负载部分） | 撤回功能可做 domain；图片下载、缓存/CDN及性能需网络/负载。 | W07/前端明确图片策略；运维提供静态资源/缓存环境。 | 功能：node scripts/verify-story-eval.mjs run --id=EV-A09-002（实现后）；负载用 load executor | 图片策略、缓存时间窗、受控 CDN、并发和 p95 阈值。 |

## 当前需拍板

1. 真实模型预算、模型/区域、token 上限和脱敏数据范围。
2. simulated 语义是否保持人工复核、不自动 PASS。
3. A01 的 3 秒/30 秒计时起点、设备矩阵和截图规则。
4. A09-002 图片下载、缓存失效时间窗和性能阈值。
5. A11 并发、持续时间、p95/错误率/锁等待/费用阈值。
6. A10 英文缺失键回退策略和首发语言范围。

这些用例保持 skeleton/BLOCKED 是依赖未授权、执行器未注册或需人工语义判断的明确结果；授权后须先补执行器和证据，再改 catalog 状态。
