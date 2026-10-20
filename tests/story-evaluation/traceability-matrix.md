# W08 评测用例追溯矩阵（A01–A13）

> 依据：规划书第 25 章验收矩阵（A01–A13）、第 16/19/20/21 章、roadmap W08 行。
> 用例目录：`tests/story-evaluation/cases/*.json`（60 例）。运行入口：`node scripts/verify-story-eval.mjs`。
>
> 口径：
> - **验收门 / 验证层级**对应规划书第 25 章六层验证：静态 → 领域规则与接口集成（domain）→ 浏览器完整流程（browser）→ 真实模型受控评测（model-simulated / model-real）→ 固定环境负载（load）→ 发布后观察。前一层通过不能代替后一层证据。
> - **状态**：本矩阵只登记定义覆盖；用例 `status=skeleton` 表示执行器未实现，运行时记 PENDING，**不计通过**。`status=implemented` 表示执行器已落地，run 时真实执行。真实模型评测（model-real）等授权与预算配置，闭环前不得正式打分。
> - 模拟 / 真实以用例字段 `modelPolicy`（none / simulated / real）区分，报告中必须可区分。

## 矩阵总览

| 验收编号 | 场景 | 通过条件（规划书 TABLE 22） | W08 用例 | 主层级 | 门槛归属 |
|---|---|---|---|---|---|
| A01 | 开始与继续 | 新开生成独立实例；继续定位原会话；旧聊天仍可用 | EV-A01-001…006（6 例） | domain + browser | W05/W03 交付，W08 端到端复核 |
| A02 | 多标签页和重复提交 | 同 requestId 不重复生成结算；revision 冲突明确 | EV-A02-001…004（4 例） | domain | W06 交付；W08 评测 |
| A03 | 断网和刷新 | 先查询保存状态；不丢已保存消息，不盲目重发 | EV-A03-001…003（3 例） | browser + domain | W03/W06 交付 |
| A04 | 跨用户访问 | 猜测 run、event、share 标识不能读到私密内容 | EV-A04-001…004（4 例） | domain | W05/W07 交付 |
| A05 | 接受与拒绝 | 后续剧情分别遵守用户决定，拒绝不是假接受 | EV-A05-001…008（8 例） | model-simulated | **W08 主责** |
| A06 | 编辑与删除历史 | 受影响事件和摘要失效；新剧情不引用旧后果 | EV-A06-001…008（8 例） | domain + model | **W08 主责（模型部分）** |
| A07 | 进程重启 | 已提交回合的状态任务可恢复且不重复应用 | EV-A07-001…003（3 例） | domain | W06 交付；W08 评测 |
| A08 | 模板更新与下架 | 老实例固定版本；下架规则与历史访问清楚 | EV-A08-001…003（3 例） | domain + browser | W05 交付 |
| A09 | 分享预览与撤回 | 只公开选中内容；站内撤回生效，私密字段不外泄 | EV-A09-001…003（3 例） | browser + domain | W04/W07 交付 |
| A10 | 中文英文与手机 | 核心路径无漏译；键盘、滚动和输入法正常 | EV-A10-001…003（3 例） | browser + manual | **W08 主责** |
| A11 | 长历史与负载 | 按第 21 章冻结条件测量，报告原始数据与版本 | EV-A11-001…004（4 例） | load | **W08 主责** |
| A12 | 模型与预算 | 真实和模拟清楚区分；辅助调用有成本归集 | EV-A12-001…006（6 例） | domain + model-real | **W08 主责** |
| A13 | 导出注销和恢复 | 新对象进入完整生命周期，恢复后状态关联一致 | EV-A13-001…005（5 例） | domain | W07 交付；W08 评测 |

合计 60 例；roadmap W08 验收门覆盖 A05/A10/A11/A12 共 21 例由本工作流主责，其余为跨工作流端到端复核用例。

## 用例明细（按验收编号）

### A01 开始与继续
| 用例 | 标题 | 层级 | modelPolicy | 依赖 |
|---|---|---|---|---|
| EV-A01-001 | 新开创建独立实例与专属会话，旧聊天不混入 | domain | none | story-runs API（已上线 M3-2） |
| EV-A01-002 | 继续定位原会话并展示最近真实消息 | domain | none | M3-3 回合服务（已落地，implemented） |
| EV-A01-003 | 场景卡 3 秒内读出身份/冲突/目标 | browser | none | V0 场景详情页 |
| EV-A01-004 | 三条建议动作填入可修改，30 秒发出首条消息 | browser | none | V0 聊天页 |
| EV-A01-005 | 章节结束页展示真实片段并可继续 | browser | none | V0 章节结束页 |
| EV-A01-006 | 重新开始创建新实例，旧进度保留 | domain | none | M3-3 回合服务（已落地，implemented） |

### A02 幂等与重复提交
| 用例 | 标题 | 层级 | 依赖 |
|---|---|---|---|
| EV-A02-001 | 同 requestId 重试返回相同回合，不重复结算 | domain | M3-3 幂等（已落地，implemented） |
| EV-A02-002 | expectedRevision 冲突返回 409 不覆盖 | domain | M3-3 revision CAS（已落地，implemented） |
| EV-A02-003 | 并发创建端到端幂等（服务层已有覆盖） | domain | story-runs API |
| EV-A02-004 | UNKNOWN 先核对本地记录，不自动重发 | domain | M3-3 未知结果恢复（已落地，implemented） |

### A03 断网与刷新
| 用例 | 标题 | 层级 | modelPolicy |
|---|---|---|---|
| EV-A03-001 | 断流保留片段并标注未确认保存 | browser | simulated |
| EV-A03-002 | 刷新先查回合状态，不盲目重发 | domain | none |
| EV-A03-003 | 取消生成费用口径如实呈现 | browser | simulated |

### A04 跨用户隔离
| 用例 | 标题 | 层级 |
|---|---|---|
| EV-A04-001 | 猜测 run id 读不到他人实例 | domain |
| EV-A04-002 | 猜测 event/share 标识不可读私密数据 | domain |
| EV-A04-003 | DTO 白名单（隐藏剧情/提示词/stateJson/lease 不输出） | domain |
| EV-A04-004 | 分享快照与私密数据分离 | domain |

### A05 接受与拒绝（W08 主责，剧情评测核心）
| 用例 | 标题 | 层级 |
|---|---|---|
| EV-A05-001 | 接受路径：后续回复遵守用户决定 | model-simulated |
| EV-A05-002 | 拒绝路径：拒绝不是假接受，不得指责失约 | model-simulated |
| EV-A05-003 | 物品归属：用户保留原件时角色不能取出原件 | model-simulated |
| EV-A05-004 | 承诺未兑现：未承诺不能说已答应 | model-simulated |
| EV-A05-005 | 提前猜谜：猜测不得写成已知真相 | model-simulated |
| EV-A05-006 | 拒绝任务也形成合法结果并可结章 | domain |
| EV-A05-007 | 同一开场双路径对照（接受 vs 拒绝） | model-simulated |
| EV-A05-008 | 跨章一致性四处核对（开场/归属/提及/经历） | model-simulated |

注：A05 评测模板以 `docs/content/drafts/` 首发三篇（许棠·怀表 / 陆遥·点歌 / 秦晚·猫咖）为基准，闻舟·唱片店已由团队负责人确认替换为秦晚；准确性以人工复核的后续回复为准，不以 JSON 可解析为通过条件（第 20 章）。hiddenFacts 扫描（EV-A04-003 / EV-A09-003）以各篇「公开信息与隐藏事实（内部模板字段）」小节内容为负例来源；受控模板改写后若 hiddenFacts 落为结构化字段，以 content-writer 补充的字段命名约定为准。

### A06 编辑与删除历史
| 用例 | 标题 | 层级 |
|---|---|---|
| EV-A06-001 | 编辑第 N 回合同事务失效 N 及之后事件/快照 | domain |
| EV-A06-002 | 删除消息同事务失效并提升 revision | domain |
| EV-A06-003 | 重建用最近有效检查点，旧摘要不再注入 | domain |
| EV-A06-004 | 新剧情不引用已失效旧后果 | model-simulated |
| EV-A06-005 | 旧发送/重生成/编辑/删除不得绕过状态机 | domain |
| EV-A06-006 | 回合序号定义因果，不依赖 createdAt | domain |
| EV-A06-007 | 用户纠错使依赖错误事实的摘要失效 | domain |
| EV-A06-008 | 纠错后模型输出遵守修正后事实 | model-simulated |

### A07 进程重启
| 用例 | 标题 | 层级 |
|---|---|---|
| EV-A07-001 | 重启后已提交回合的状态任务可恢复 | domain |
| EV-A07-002 | 恢复不重复应用同一事件 | domain |
| EV-A07-003 | 租约超时可恢复，不重复外部模型生成 | domain |

### A08 模板更新与下架
| 用例 | 标题 | 层级 |
|---|---|---|
| EV-A08-001 | 老实例固定原版本不受模板更新影响 | domain |
| EV-A08-002 | 下架禁新开，已有实例按策略明确返回 | domain |
| EV-A08-003 | 下架保留用户历史查看与导出 | browser |

### A09 分享预览与撤回
| 用例 | 标题 | 层级 |
|---|---|---|
| EV-A09-001 | 只公开选中片段，默认不勾选私密备注 | browser |
| EV-A09-002 | 撤回后站内不可继续读取 | domain |
| EV-A09-003 | 隐藏真相不在回顾/分享卡/解释中泄漏 | domain |

### A10 中英文与手机（W08 主责）
| 用例 | 标题 | 层级 |
|---|---|---|
| EV-A10-001 | 英文路径无漏译、无缺失键直出 | browser |
| EV-A10-002 | 切换语言后故事进度不丢失 | domain |
| EV-A10-003 | 移动端键盘/组合输入/长文本粘贴实机检查 | manual |

### A11 长历史与负载（W08 主责）
| 用例 | 标题 | 层级 |
|---|---|---|
| EV-A11-001 | 1 万条历史分页加载，滚动输入可用 | load |
| EV-A11-002 | 列表/状态接口 p95 ≤ 300ms（阈值冻结后判定） | load |
| EV-A11-003 | 20 → 50 并发生成（模拟上游） | load |
| EV-A11-004 | 负载报告记 p50/p95/错误率/内存/锁等待/费用 | load |

注：负载用例使用隔离 SQLite 与随机端口，不占用 3000/18782；阈值以 M0 冻结条件为准，未冻结前记 PENDING 不打分。

### A12 模型与预算（W08 主责）
| 用例 | 标题 | 层级 | modelPolicy |
|---|---|---|---|
| EV-A12-001 | 上下文预算 6k–10k 输入 / 300–700 输出试测 | model-real | real |
| EV-A12-002 | 普通回合零辅助模型调用 | domain | none |
| EV-A12-003 | 结章/关键节点才触发状态提取 | domain | simulated |
| EV-A12-004 | 辅助成本归集；整理失败不重复扣聊天费用 | domain | none |
| EV-A12-005 | 真实/模拟区分，报告含版本/条件/原始数据/阈值 | manual | none |
| EV-A12-006 | 预算不足停用可选总结、保留已保存内容 | domain | none |

注：model-real 用例需 `STORY_EVAL_ALLOW_REAL_MODEL=1` 且配置 `STORY_EVAL_REAL_MODEL_BUDGET_TOKENS`，否则 BLOCKED，不得用模拟结果顶替。

### A13 导出注销与恢复
| 用例 | 标题 | 层级 |
|---|---|---|
| EV-A13-001 | 注销删除覆盖全部新增故事对象 | domain |
| EV-A13-002 | 导出含故事数据且不含他人信息 | domain |
| EV-A13-003 | 已删消息的派生记忆同步删除或失效 | domain |
| EV-A13-004 | 备份恢复后状态关联一致 | domain |
| EV-A13-005 | 日志无正文/提示词/密钥 | domain |

## 执行器落地记录（2026-10-20，eval-executor / W08）

- **domain 执行器**（`executors/domain.mjs`）：直接调用 M3-3 真实服务层（turn-service / run-service / message-service / conversation-service / chat-application-service），数据落在一次性隔离 SQLite（`scripts/helpers/create-isolated-db.mjs`，node:sqlite 应用迁移），不连生产库。已 implemented 15 例：EV-A01-001/002/006、EV-A02-001/002/003/004、EV-A03-002、EV-A04-001/003、EV-A06-001/002/005/006、EV-A12-002。
- **model-simulated 执行器**（`executors/model-simulated.mjs`）：在 `DISABLE_MOCK_AI=false` 模拟模式下自动断言第 19 章事件流契约（accepted/demo/delta/committed/state_pending/done、统一 turnId、committed 返回消息标识）与「同键重放不发模型」（重放流恰为 committed→state_pending→done、aiCall 计数不增）。已 implemented 7 例：EV-A05-001/002/003/004/005/007/008。**model-output 语义断言不自动判分**：契约断言通过后记 PENDING 并进人工复核队列（结果 JSON 带 `review` 字段），绝不伪造语义通过。
- **运行入口**：`node scripts/verify-story-eval.mjs run` 在选中已实现用例时自动以 `node --import tsx` 重启自身（`STORY_EVAL_EXECUTOR_CHILD` 防递归）；退出码语义：0=无 FAIL/ERROR，2=存在 FAIL/ERROR，3=无任何用例实际执行。隔离库由执行器主动清理（`STORY_EVAL_KEEP_DB=1` 可保留排查）。
- **结构测试红线（已随执行器落地调整）**：原「框架阶段 pass===0」收窄为等价约束——**PASS 只能来自 status=implemented 且 verificationTier 已注册执行器的用例**；skeleton 用例一律 PENDING/BLOCKED，不得 PASS/FAIL；model-real 无授权+无预算必须 BLOCKED；model-output 待人工复核的用例记 PENDING 不得自动 PASS。见 `story-evaluation.test.mjs` 第 5–7 个测试。
- **依赖解除说明**：EV-A06-001/002 的原依赖「M4 历史失效事务」已随 M3-3 落地（`src/lib/stories/lifecycle/invalidation.ts`，message-service 同事务调用，contract §7），两例转 implemented。EV-A06-005 口径同步更新：旧 SEND/REGENERATE 仍 409；编辑/删除走同事务失效（不再 409）。
- **已知漂移**：`tests/story-run-service.test.mjs`「old writes cannot bypass story lifecycle」一例仍断言编辑/删除 409，与 M3-3 失效事务语义不一致（该文件不在 W08 写作范围，未改动，需归属团队处理）。

## 内容种子案例映射（docs/content/drafts/README.md EV-01–EV-15）

任务 #10 交付的三篇内容各含 5 条种子案例，是 model-simulated 层用例的具体输入；60 例骨架可在每条种子上按“三主角 × 三分支”扩展。映射关系（种子是素材，不替代本矩阵的用例定义与状态机口径）：

| 种子 | 类型 | 对应本矩阵用例 |
|---|---|---|
| EV-01 / EV-06 / EV-11 | 正常推进（基线） | EV-A05-001（正常分支）、EV-A05-007（对照集基准） |
| EV-02 / EV-07 / EV-12 | 拒绝路径（A05） | EV-A05-002、EV-A05-006 |
| EV-03 / EV-08 / EV-13 | 提前猜出隐藏真相 | EV-A05-005、EV-A04-003、EV-A09-003 |
| EV-04 / EV-09 / EV-14 | 改写历史与失效（A06） | EV-A06-001、EV-A06-003、EV-A06-004、EV-A06-008 |
| EV-05 / EV-10 / EV-15 | 重进一致性 | EV-A05-008（四处一致）、EV-A01-002、EV-A01-006 |

各章 confirmed 事实清单（FACT/PROMISE/RELATIONSHIP/事件结果，含证据要求与分支条件）作为状态抽取断言的预期输出样例；执行器实现时以事实清单校验 StoryEvent，而非仅校验 JSON 可解析。

## 与既有测试的关系（不重复、不遗漏）

| 既有测试 | 覆盖内容 | 与本矩阵的关系 |
|---|---|---|
| tests/story-run-service.test.mjs | 创建幂等、409、DTO 白名单、级联删除、旧路径拒绝 | EV-A02-003 / EV-A04-001/003 / EV-A06-005 / EV-A13-003 的服务层基线；评测框架保留端到端口径防回归 |
| tests/stories-v0.test.mjs | 场景卡、建议动作、结束页真实片段 | EV-A01-003/004/005 的领域规则基线；浏览器证据仍需 browser 层用例 |
| tests/logger-privacy.test.mjs | 日志隐私既有口径 | EV-A13-005 扩展到故事链路新增日志点 |

## 维护规则

1. 新增/修改用例只改 `tests/story-evaluation/cases/*.json`，并同步更新本矩阵对应行。
2. 每个阶段结束写明：已完成项、对应 A 编号、未通过项处理方式（补丁 E）。
3. 状态变更路径：skeleton → implemented（执行器落地）→ verified（最近一次执行通过）。verified 只能由 run 产生的执行记录支撑，不得手工标注。
