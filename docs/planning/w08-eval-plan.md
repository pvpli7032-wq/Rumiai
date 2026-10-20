# W08 评测与性能框架设计（60 例评测骨架）

> 负责人：eval-builder（W08）。状态：框架就绪，真实评测等 M4 闭环。
> 依据：roadmap W08 行（写作用域 `tests/story-evaluation/**`、故事测试、`scripts/verify-story-*.mjs`；只读业务源）；规划书第 16/19/20/21/25 章；HANDOFF.md 第 10 节工程约定。

## 1. 目标与边界

- **现在交付**：60 例评测用例定义、A01–A13 追溯矩阵、结构校验测试、运行入口骨架（列出 / 筛选 / 报告 / 调度）。
- **暂不交付**：任何“通过”结论。roadmap 明确“框架可提前，真实评测等闭环”；闭环前所有用例记 PENDING/BLOCKED，不伪造通过，不正式打分。
- **写作用域**：`tests/story-evaluation/**`、`scripts/verify-story-eval.mjs`、本文件。`src/`、`prisma/` 只读。

## 2. 目录结构

```
tests/story-evaluation/
├── catalog.mjs                    # 用例加载、结构校验、筛选、汇总
├── runner.mjs                     # 执行调度器：层级→执行器注册表，产出 PASS/FAIL/PENDING/BLOCKED/ERROR
├── story-evaluation.test.mjs      # node:test 结构校验（≥60 例、A01–A13 覆盖、禁止无执行器时出现 PASS）
├── cases/                         # 用例定义（13 个 JSON，按验收编号分组）
│   ├── a01-start-continue.json
│   ├── a02-idempotency.json
│   ├── a03-network-refresh.json
│   ├── a04-cross-user.json
│   ├── a05-accept-reject.json
│   ├── a06-edit-delete-history.json
│   ├── a07-process-restart.json
│   ├── a08-template-lifecycle.json
│   ├── a09-share-withdraw.json
│   ├── a10-i18n-mobile.json
│   ├── a11-long-history-load.json
│   ├── a12-model-budget.json
│   └── a13-lifecycle-privacy.json
└── traceability-matrix.md         # A01–A13 追溯矩阵

scripts/verify-story-eval.mjs      # 运行入口：validate | list | report | run
```

用例分布：A01:6、A02:4、A03:3、A04:4、A05:8、A06:8、A07:3、A08:3、A09:3、A10:3、A11:4、A12:6、A13:5 = 60。
W08 验收门（A05/A10/A11/A12）共 21 例主责；其余为跨工作流端到端复核用例（矩阵中标注归属）。

## 3. 场景定义格式（JSON）

每个文件为 `{ "schemaVersion": 1, "cases": [ ... ] }`，单条用例字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 全局唯一，格式 `EV-A{编号}-{序号}`，如 `EV-A05-001` |
| `title` | 是 | 一句话目标 |
| `acceptance` | 是 | 关联的验收编号数组（可多挂，如 `["A04","A09"]`） |
| `ownerWorkflow` | 是 | 主责工作流（W05/W06/W07 交付、W08 评测） |
| `verificationTier` | 是 | 验证层级：`static / domain / browser / load / model-simulated / model-real / manual`（规划书第 25 章六层 + 人工项） |
| `modelPolicy` | 是 | `none`（不调模型）/ `simulated`（模拟上游）/ `real`（真实模型，须授权） |
| `status` | 是 | `skeleton`（执行器未实现）/ `implemented` / `verified`（仅由运行记录支撑） |
| `description` | 是 | 规划书章节依据、与既有测试的关系 |
| `steps` | 是 | `[{actor, action, expect}]`，可执行的操作序列 |
| `assertions` | 是 | `[{kind, target, expect}]`；kind 如 `http-status / state / dom / metric / model-output / process / manual` |
| `dependsOn` | 建议 | 依赖的实现项，PENDING/BLOCKED 时的原因来源 |

**后续填充方式**：内容/qa 角色只改 `cases/*.json` 增补用例（同步更新矩阵行）；工程角色实现对应层级执行器并把 `status` 改为 `implemented`。校验由 `catalog.mjs` 与结构测试自动把关。

## 4. 运行入口

```
node scripts/verify-story-eval.mjs validate            # 结构校验
node scripts/verify-story-eval.mjs list --acceptance=A05 --tier=model-simulated
node scripts/verify-story-eval.mjs report [--json]     # 按验收编号/层级/模型策略汇总
node scripts/verify-story-eval.mjs run --acceptance=A12
```

退出码：0 成功；1 结构/参数错误；2 存在 FAIL/ERROR；**3 = 无任何用例实际执行（M4 闭环前的预期状态，不是通过也不是失败）**。

## 5. 防“伪造通过”机制

1. `runner.mjs`：无执行器一律 PENDING（执行器未实现）或 BLOCKED（依赖缺失）；真实模型未授权（缺 `STORY_EVAL_ALLOW_REAL_MODEL=1` 或预算 `STORY_EVAL_REAL_MODEL_BUDGET_TOKENS`）强制 BLOCKED。
2. 结构测试断言：无执行器状态下 `summary.pass === 0`，任何结果不得为 PASS。
3. `status=verified` 只能由 run 的执行记录支撑，不得手工标注；报告必须含提交版本、环境、原始数据、阈值（W08 验收门要求）。
4. 模拟/真实以 `modelPolicy` 字段贯穿用例定义、运行结果与报告，全程可区分；model-real 结果不得用模拟结果顶替。

## 6. 执行器实现计划（按里程碑）

| 里程碑 | 执行器 | 要点 |
|---|---|---|
| M4 闭环后 | `domain` | 直接调用 `src/lib/stories` 服务与 story-runs 端点；隔离 SQLite（参照 `tests/story-run-service.test.mjs` 的 `file:./<pid>-<ts>.db` 模式）；断言 revision/事件失效/幂等 |
| M4 闭环后 | `model-simulated` | 模拟上游 SSE（参照第 19 章事件流契约：accepted/delta/committed/state_pending/error/done）；`model-output` 类断言进人工复核队列，不自动判分 |
| M5 | `model-real` | 双开关授权 + token 预算上限；按第 23 章口径归集成本；失败不丢已提交结果 |
| M5 | `load` | 第 21 章固定场景（短会话/长历史/同实例并发写/混合负载）；采集 p50/p95、错误率、内存、SQLite 锁等待、活跃连接、每轮费用 |
| M2+ | `browser` | 复用 `scripts/verify-*-browser.mjs` 模式读 `.next-build`；**随机端口，不占用 3000/18782** |
| 随用例 | `manual` | 输出人工记录表模板，人工结论逐项登记，不伪装自动通过 |

## 7. 运行约束（与并行开发隔离）

- 测试一律自建隔离 SQLite 与独立会话；不连接生产数据库，不调用真实付费模型（除非走 model-real 双开关）。
- 浏览器/HTTP 类执行绑定随机端口；m3-backend 等并行开发占用 3000/18782 不受影响。
- 不 git commit/push；不改 `src/`、`prisma/`。

## 8. 当前验证记录（2026-10-20）

- `node --import tsx --test tests/story-evaluation/story-evaluation.test.mjs`：5 条结构测试全过（60 例、ID 唯一、A01–A13 每编号 ≥2 例、真实模型用例门禁）。
- `node scripts/verify-story-eval.mjs validate / report / list --acceptance=A05`：正常。
- `node scripts/verify-story-eval.mjs run --acceptance=A12`：1 BLOCKED（真实模型未授权）+ 6 PENDING，退出码 3（预期框架阶段信号）。
- 已知限制：所有用例 status=skeleton；A05/A06 模型类用例的评测模板基准为 `docs/content/drafts/` 首发三篇（EV-01–EV-15 种子案例，映射见 traceability-matrix.md「内容种子案例映射」节）；A11 依赖 M0 性能条件冻结。
