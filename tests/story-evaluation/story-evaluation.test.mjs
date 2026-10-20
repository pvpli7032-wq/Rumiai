// W08 评测框架 · 结构校验测试（node --import tsx --test 可直接运行）
// 本测试只验证用例目录的完整性与口径一致性，不执行业务评测，也不产生任何“通过”结论。
// 真实评测由 scripts/verify-story-eval.mjs run 在 M4 闭环后执行。

import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCatalog, ACCEPTANCE_IDS, VERIFICATION_TIERS, MODEL_POLICIES} from './catalog.mjs';
import {runCases, RESULT} from './runner.mjs';

const {cases, errors, total} = loadCatalog();

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

test('real-model cases are gated: framework never fabricates a pass', async () => {
  const realCases = cases.filter(c => c.modelPolicy === 'real');
  assert.ok(realCases.length > 0, '应保留真实模型用例（A12），即使当前记 PENDING');
  const {results, summary} = await runCases();
  for (const r of results) {
    assert.notEqual(r.result, RESULT.PASS, r.id + ' 在无执行器状态下不得为 PASS');
  }
  assert.equal(summary.pass, 0, '框架阶段不产生任何 PASS');
  assert.equal(summary.selected, total, '全部用例都应被调度并得到明确状态（PENDING/BLOCKED）');
});
