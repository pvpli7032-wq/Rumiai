// W08 评测框架 · 结构校验测试（node --import tsx --test 可直接运行）
// 本测试验证用例目录的完整性与口径一致性，并真实调度一次全量用例：
// domain / model-simulated 执行器在一次性隔离 SQLite 上运行（不连生产库、不调用真实模型），
// model-real 无授权必须 BLOCKED。红线：PASS 只能来自已注册执行器 + implemented 用例；
// model-output 语义断言进人工复核队列，记 PENDING，不自动判分。

import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCatalog, ACCEPTANCE_IDS, VERIFICATION_TIERS, MODEL_POLICIES} from './catalog.mjs';
import {runCases, RESULT, REGISTERED_TIERS} from './runner.mjs';
import {disposeEvaluationEnvironment} from './executors/harness.mjs';

const {cases, errors, total} = loadCatalog();
// 真实执行全量用例（domain / model-simulated 执行器落在一次性隔离 SQLite 上，
// 不连生产库、不调用真实模型）。所有红线断言基于这份运行结果。
const {results, summary} = await runCases();
const byId = new Map(cases.map(c => [c.id, c]));
const resultById = new Map(results.map(r => [r.id, r]));

test.after(async () => { await disposeEvaluationEnvironment().catch(() => {}); });

test('catalog loads without structural errors and holds at least 60 cases', () => {
  assert.deepEqual(errors, [], '用例文件存在结构错误：' + errors.join(' | '));
  assert.ok(total >= 60, `用例数须不少于 60，当前 ${total}`);
});

test('case ids are globally unique', () => {
  const ids = cases.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every acceptance scenario A01-A13 has at least two cases', () => {
  for (const code of ACCEPTANCE_IDS) {
    const n = cases.filter(c => c.acceptance.includes(code)).length;
    assert.ok(n >= 2, `${code} 覆盖用例不足 2 条（当前 ${n}）`);
  }
});

test('every case declares verifiable steps and assertions tied to a known tier and model policy', () => {
  for (const c of cases) {
    assert.ok(VERIFICATION_TIERS.includes(c.verificationTier), c.id + ' 层级未知');
    assert.ok(MODEL_POLICIES.includes(c.modelPolicy), c.id + ' modelPolicy 未知');
    for (const step of c.steps) {
      assert.ok(step.action && step.expect, c.id + ' 步骤缺少 action/expect');
    }
    for (const a of c.assertions) {
      assert.ok(a.kind && a.expect, c.id + ' 断言缺少 kind/expect');
    }
  }
});

test('real-model cases are gated: no authorization means BLOCKED, never a pass', () => {
  const realCases = cases.filter(c => c.modelPolicy === 'real');
  assert.ok(realCases.length > 0, '应保留真实模型用例（A12），即使当前记 BLOCKED');
  for (const c of realCases) {
    const r = resultById.get(c.id);
    assert.equal(r.result, RESULT.BLOCKED, c.id + ' 无授权时必须 BLOCKED');
    assert.match(r.reason, /STORY_EVAL_ALLOW_REAL_MODEL/, c.id + ' 阻塞原因必须写明授权开关');
  }
});

test('red line: a case can only PASS through a registered executor on an implemented case', () => {
  // 等价约束（框架阶段为「无执行器用例 pass===0」，执行器落地后收窄为）：
  // PASS 只能出现在 status=implemented 且 verificationTier 已注册执行器的用例上；
  // skeleton / 其他层级用例一律 PENDING/BLOCKED，绝不为 PASS 或 FAIL。
  for (const r of results) {
    const c = byId.get(r.id);
    assert.ok(c, '运行结果必须能对应到目录用例 ' + r.id);
    if (r.result === RESULT.PASS) {
      assert.equal(c.status, 'implemented', r.id + ' PASS 只允许来自 implemented 用例');
      assert.ok(REGISTERED_TIERS.includes(c.verificationTier), r.id + ' PASS 只允许来自已注册执行器的层级');
    }
    if (c.status !== 'implemented') {
      assert.ok([RESULT.PENDING, RESULT.BLOCKED].includes(r.result), r.id + ' 未实现执行器的用例不得为 ' + r.result);
    }
    if (REGISTERED_TIERS.includes(c.verificationTier) && c.status === 'implemented') {
      assert.ok([RESULT.PASS, RESULT.FAIL, RESULT.PENDING].includes(r.result), r.id + ' 已实现用例必须得到真实执行结论，不得停留在 ' + r.result);
    }
  }
  assert.equal(summary.pass, results.filter(r => r.result === RESULT.PASS).length, 'PASS 计数一致');
});

test('implemented cases currently all execute green; semantic review stays PENDING, never PASS', () => {
  assert.equal(summary.fail, 0, '已实现用例当前必须全绿（出现 FAIL 说明业务行为或剧本回归）');
  assert.equal(summary.error, 0, '框架自身不得出错');
  const reviewed = results.filter(r => r.review);
  assert.ok(reviewed.length > 0, 'model-simulated 的人工复核队列必须非空');
  for (const r of reviewed) {
    assert.equal(r.result, RESULT.PENDING, r.id + ' 语义待人工复核的用例不得自动判 PASS');
  }
  assert.equal(summary.selected, total, '全部用例都应被调度并得到明确状态');
});
