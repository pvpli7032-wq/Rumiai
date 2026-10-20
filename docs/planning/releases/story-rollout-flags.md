# Story 模块灰度开关设计（R4 试点 / M5）

> 状态：**设计文档，未实现**。开关代码落点为建议，实现须另立任务、获批准后进行。
> 依据：规划书第 27 章（渐进上线：先新增页面与功能开关）、第 22 章（实验设计）、`docs/planning/roadmap.md` R4 批次行与发布固定操作门、`docs/planning/releases/m5-pilot-runbook.md`。
> 目标：story 四块能力（新建实例 / 回合编排 / 结章 / worker）各自可独立关闭，且关闭顺序保证回滚红线——**先关 worker / 写入，再切回旧应用**；故事开关关闭不得触发重复扣费或退款。

## 1. 设计原则

1. **默认值即试点档位**：所有旗标默认全开（试点名单内），收紧靠 set env + PM2 重启，不依赖代码改动。
2. **关闭 = 拒绝新工作，不隐藏既有事实**：关闭某开关时，存量记录保留、只读可见，不伪装连续剧情（第 27 章回退操作口径）。
3. **关闭不得影响普通聊天**：旗标检查只落在 story 分支入口，普通会话路径零改动（M3-3 回归 A 组 15 项零变化是红线）。
4. **不碰计费语义**：回合/整理的额度预留与结算逻辑不在旗标范围内；旗标只控制"是否开始新工作"。
5. **env 命名与既有约定一致**：沿用 `STORY_WORKER_DISABLED=1` 的 `<NAME>_DISABLED` 风格，值为字符串 `"1"` 时生效（trim 后比较，同 `src/instrumentation.ts:15`）。

## 2. 开关清单与代码落点建议

| # | 开关（env） | 控制范围 | 建议代码落点 | 关闭行为 | 状态 |
|---|---|---|---|---|---|
| F1 | `STORY_RUNS_DISABLED=1` | 新建故事实例（POST /api/story-runs 的 createStoryRun）；GET 列表/详情不受限 | `src/app/api/story-runs/route.ts` POST 分支入口，在调用 `createStoryRun` 前检查 | 返回 503 + 固定错误码（如 `STORY_RUNS_PAUSED`，文案不承诺时间），存量实例 GET 正常 | 待实现 |
| F2 | `STORY_TURNS_DISABLED=1` | 故事回合编排（POST /api/story-runs/[id]/turns）；轮询 GET turn 不受限 | `src/app/api/story-runs/[id]/turns/route.ts` POST 分支入口，进入 `turn-service.ts` 编排前检查 | 返回 503 + `STORY_TURNS_PAUSED`；进行中回合不强制中断，等自然落定 | 待实现 |
| F3 | `STORY_CLOSE_DISABLED=1` | 结章（POST /api/story-runs/[id]/close-chapter）；resume 恢复不受限 | `src/app/api/story-runs/[id]/close-chapter/route.ts` 入口，进入 `chapter-service.ts` 前检查 | 返回 503 + `STORY_CLOSE_PAUSED`；结章门（STATE_NOT_READY 等 422）语义不变 | 待实现 |
| F4 | `STORY_WORKER_DISABLED=1` | state worker 整体（状态整理、结章后整理、恢复处理） | `src/instrumentation.ts`（启动前跳过） | worker 不启动；PENDING 停留、不伪成功；普通聊天不受影响 | **已实现**（提交 `ed0cd03`） |

落点选择理由：

- 四个落点都是**入口薄层**（route 或 instrumentation），不进领域层（`turn-service.ts` / `chapter-service.ts` / `state-worker.ts` / `repository/**`），保证测试套件（story-run/turn/lifecycle）在无旗标环境下行为逐字节不变；
- 统一走 env 而不是数据库表：发布窗口与降级路径要求"重启即生效、不依赖写库"，且避免为开关新建表/迁移（违反"迁移只许增量、最小必要"约定）；
- 错误码与文案：503 与既有 503 边界行为口径一致（deploy README 边界），错误体带独立 `code` 字段便于前端与日志区分，日志只记标识与错误码、不输出用户正文（第 27 章日志口径）。

### 实现注意（留给执行任务）

- 旗标读取集中在单一 helper（如 `src/lib/stories/rollout-flags.ts`），四处入口共用，避免散落字符串比较；
- F1/F2/F3 关闭时**不得**触发任何额度预留（检查必须在 reserve 之前）；
- 每个旗标至少三条测试：默认开（行为不变）、关闭时拒绝码正确、关闭时普通聊天路径零变化（沿用 m0-route-behavior 14 条作回归）。

## 3. 灰度观察指标（观察期每日记录）

### 3.1 产品漏斗（对接 SceneFunnelEvent 四比率）

事件枚举：`src/lib/analytics/scene-funnel-service.ts` 的 `SCENE_FUNNEL_EVENTS`（`scene_opened` / `scene_first_message_sent` / `scene_active_end_confirmed` / `scene_close_continue_clicked`）；聚合报表：`scene-funnel-report-service.ts`（管理端已上线，提交 `be80b61`）。

| 比率 | 定义（锚定 opened 窗口） | 对应第 22 章口径 |
|---|---|---|
| 开场到达率 | scene_first_message_sent 会话 / scene_opened 会话 | 用户能否理解开始方式 |
| 首条消息发出率 | 已发首条的会话占比 | 同上 |
| 主动结束率 | scene_active_end_confirmed / 已发首条 | 用户理解身份与结束入口 |
| 结束页继续点击率 | scene_close_continue_clicked / active_end_confirmed | **继续同一故事**——主指标（七日回访）的行为代理 |

主指标（第 22 章）：有效开始故事的用户中，七天内再次继续同一故事的比例。V1 试点期以四比率为日常代理指标，主指标按两轮实验设计（8–12 名访谈 → 同角色同模型旧新对照，两个七日窗口）在访谈与对照记录中结算，**不用任意小样本百分比宣布成功**。

### 3.2 回合状态健康度（SQL 直查生产库，只读）

数据源：`story_turns.stateStatus`（`src/lib/stories` 回合状态机：PENDING → PROCESSING → 已处理 / FAILED / INVALIDATED）+ `leaseOwner` / `leaseExpiresAt`（schema 1518–1530 行，索引 `[runId, stateStatus, leaseExpiresAt]`）。

| 指标 | 采集 | 健康态 |
|---|---|---|
| PENDING 积压 | `count where stateStatus='PENDING'` | 随 worker 处理回落，不持续增长 |
| PROCESSING 滞留 | `count where stateStatus='PROCESSING' and lease_expires_at < now()` | 0（租约过期即视为滞留） |
| FAILED 计数与增量 | 总数 + 按小时增量 | 增量趋 0；出现 `STATE_DATA_CORRUPT` 即触发暂停评估 |
| INVALIDATED 比例 | 失效回合 / 总回合 | 与用户编辑删除行为对应，无异常放大 |
| worker 预算拒绝 | `story-state-quota`（额度预留）拒绝计数 | 在预算内（第 23 章平台承担整理成本，不在用户未知时另扣余额） |

### 3.3 技术与成本指标（roadmap 发布固定操作门第 4 条）

- PM2：restarts、内存、5xx 计数（Nginx/应用日志）；
- 写入错误与延迟：消息落库失败（PERSISTENCE_ERROR）计数；
- SQLite 锁等待：`database is locked` 日志计数（worker 与前台写入共享单库，重点观察）；
- AI 费用：每章可变成本对齐第 23 章公式（0.16×P + 0.006×Q 每章基准 + 辅助调用/失败重试单列），试点期记实际 token 用量，不预设结论；
- 旧聊天回归：普通会话发送/重生成冒烟每日一次。

## 4. 扩量 / 暂停决策门槛（对齐第 22/27 章与 roadmap R4）

### 4.1 扩量条件（全部满足才扩下一档）

| # | 条件 | 来源 |
|---|---|---|
| E1 | 观察期内无 P0/P1 数据/权限/恢复问题 | roadmap M5 退出条件 |
| E2 | PENDING 积压回落、FAILED 增量趋 0、无 STATE_DATA_CORRUPT、无租约滞留 | §3.2 |
| E3 | 四比率相对 V0 基线方向改善（至少不劣化）；关键事实无严重自相矛盾 | 第 22 章继续投入条件 |
| E4 | 单位体验成本在预算内（第 23 章口径实测） | 第 22 章 + roadmap"费用"观察项 |
| E5 | 回退演练与告警门通过（本批次的 B4 双态验证 + E1/E3 演练记录） | roadmap R4"回退演练和告警门通过再扩量" |

扩量档位（第 27 章渐进上线，对应 TABLE 25 观察重点）：试点名单（8–12 人，访谈轮）→ 小范围灰度（同角色同模型对照轮）→ 扩大开放。每档至少覆盖一个完整七日观察窗口再评估。

### 4.2 暂停条件（任一触发即降级，按 m5-pilot-runbook §6 执行）

| # | 触发 | 动作 |
|---|---|---|
| P1 | 出现剧情假记忆信号（用户未答应却被说成已答应） | 停内容侧评估；工程侧校验来源候选确认链路（TABLE 26 应对） |
| P2 | STATE_DATA_CORRUPT 或 FAILED 持续增长 | `STORY_WORKER_DISABLED=1` 停 worker（E1），保留已提交结果 |
| P3 | 租约滞留 / SQLite 锁等待持续上升，影响普通聊天 | 先停 worker（F4），仍影响则 E2 关回合写入 |
| P4 | 单位成本超预算（第 23 章预算上限） | 停用可选总结/延后整理（F4），保留已保存内容；不以编造回复兜底 |
| P5 | 权限越界、隐私外泄、备份不可读等数据安全问题 | **即停**：停写 + F1+F2+F3+F4 全关 + 按 runbook E3/E4 处置并上报 |
| P6 | 首日尝鲜提升但七日回访无改善 | 不扩量；先改内容与因果反馈（第 22 章"若只有第一天尝鲜提升"条款），不是工程扩容问题 |

### 4.3 决策记录

每次扩量/暂停写记录：触发指标快照（§3 数据）、依据条款编号（E*/P*）、决策人、旗标变更（含 env 值与重启时刻）。日志只记录必要标识和错误码，不输出用户正文、系统提示词或模型密钥（第 27 章）。

## 5. 与其他文档的关系

- 执行层面：`docs/planning/releases/m5-pilot-runbook.md`（旗标未实现前的降级兜底 = `STORY_WORKER_DISABLED=1` + 手工停写）；
- 规划依据：规划书第 22 章（实验设计）、第 27 章（灰度与回退）、`roadmap.md` R4 批次行与发布固定操作门；
- 交接：第 27 章上线交接清单（应用版本、迁移清单、worker 启停、开关位置、预算阈值、告警规则、负责人、回退演练记录）在本文件 + runbook 操作记录 + HANDOFF 第 12 节三处闭合。
