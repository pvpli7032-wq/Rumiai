// W08 评测框架 · 执行调度器
// 职责：加载用例 → 按验证层级调度执行器 → 产出结构化结果。
// 红线：skeleton 状态的用例一律记 PENDING，绝不伪造通过；真实模型用例未获授权记 BLOCKED。

import {loadCatalog, filterCases, summarize} from './catalog.mjs';
import {domainExecutor} from './executors/domain.mjs';
import {modelSimulatedExecutor} from './executors/model-simulated.mjs';

export const RESULT = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  PENDING: 'PENDING',   // 用例已定义，执行器未实现；或语义断言待人工复核（model-simulated）
  BLOCKED: 'BLOCKED',   // 依赖缺失（如真实模型未授权、M4 未闭环）
  ERROR: 'ERROR',       // 框架自身异常
};

// 执行器注册表：key = verificationTier。按 docs/planning/w08-eval-plan.md 第 6 节逐步落地：
// - domain / model-simulated：已实现（M3-3 回合服务口径；model-output 断言进人工复核队列）。
// TODO(W08/M5): 实现 model-real 执行器（须显式授权 env 开关 + 预算上限，缺一即 BLOCKED）。
// TODO(W08/M5): 实现 load 执行器（固定场景压测，采集 p50/p95/锁等待/费用）。
// TODO(W08/M2+): browser 执行器复用 scripts/verify-*-browser.mjs 的模式；manual 用例输出人工记录表。
const executors = new Map([
  ['domain', domainExecutor],
  ['model-simulated', modelSimulatedExecutor],
]);

/** 已注册执行器的层级。结构测试以此约束 PASS 的合法来源。 */
export const REGISTERED_TIERS = [...executors.keys()];

const REAL_MODEL_AUTH_ENV = 'STORY_EVAL_ALLOW_REAL_MODEL'; // 显式授权开关，缺省必须拒绝
const REAL_MODEL_BUDGET_ENV = 'STORY_EVAL_REAL_MODEL_BUDGET_TOKENS';

function blockedReason(c) {
  const deps = c.dependsOn ?? [];
  if (c.modelPolicy === 'real') {
    if (process.env[REAL_MODEL_AUTH_ENV] !== '1') return '真实模型未获显式授权（STORY_EVAL_ALLOW_REAL_MODEL=1）';
    if (!process.env[REAL_MODEL_BUDGET_ENV]) return '真实模型预算未配置（STORY_EVAL_REAL_MODEL_BUDGET_TOKENS）';
  }
  if (c.status !== 'implemented') return `执行器未实现（status=${c.status}），等待依赖：${deps.join('、') || '待定义'}`;
  return null;
}

export async function runCases(options = {}) {
  const {cases, errors} = loadCatalog(options.catalog ?? {});
  const selected = filterCases(cases, options.filter ?? {});
  const results = [];
  for (const c of selected) {
    const reason = blockedReason(c);
    if (reason) {
      // 未获授权/未配置预算属于 BLOCKED；执行器未实现属于 PENDING。两者都不是通过。
      const isBlocked = c.status === 'implemented' || c.modelPolicy === 'real';
      results.push({id: c.id, acceptance: c.acceptance, tier: c.verificationTier, modelPolicy: c.modelPolicy, result: isBlocked ? RESULT.BLOCKED : RESULT.PENDING, reason});
      continue;
    }
    const executor = executors.get(c.verificationTier);
    if (!executor) {
      results.push({id: c.id, acceptance: c.acceptance, tier: c.verificationTier, modelPolicy: c.modelPolicy, result: RESULT.BLOCKED, reason: `verificationTier=${c.verificationTier} 执行器未注册`});
      continue;
    }
    try {
      const outcome = await executor(c);
      results.push({id: c.id, acceptance: c.acceptance, tier: c.verificationTier, modelPolicy: c.modelPolicy, ...outcome});
    } catch (error) {
      results.push({id: c.id, acceptance: c.acceptance, tier: c.verificationTier, modelPolicy: c.modelPolicy, result: RESULT.ERROR, reason: String(error?.message ?? error)});
    }
  }
  const count = key => results.filter(r => r.result === key).length;
  return {
    catalogErrors: errors,
    results,
    summary: {
      selected: selected.length,
      pass: count(RESULT.PASS),
      fail: count(RESULT.FAIL),
      pending: count(RESULT.PENDING),
      blocked: count(RESULT.BLOCKED),
      error: count(RESULT.ERROR),
    },
  };
}

export {loadCatalog, filterCases, summarize};
