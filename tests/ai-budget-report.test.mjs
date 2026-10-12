import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDailyBudgets, evaluateDailyBudgets, readDailyBudgetReport } from '../src/lib/ai/budget-report.ts';

test('budget configuration is optional, explicit and validates currency and amounts', () => {
  assert.equal(parseDailyBudgets(''), null);
  assert.deepEqual(parseDailyBudgets('{"USD":{"site":10,"user":1}}'), { USD: { site: 10, user: 1 } });
  for (const raw of ['null', '[]', '{}', '{"usd":{"site":1}}', '{"USD":{"site":0}}', '{"USD":{"site":"10"}}', '{"USD":{"other":1}}', '{']) assert.throws(() => parseDailyBudgets(raw));
});

test('site and user thresholds stay separate by currency and unknown costs remain visible', () => {
  const report = evaluateDailyBudgets({ USD: { site: 3, user: 2 }, CNY: { site: 100 } }, [
    { userId: 'a', currency: 'USD', knownCost: 2, unknownCalls: 1 },
    { userId: 'b', currency: 'USD', knownCost: 1, unknownCalls: 0 },
    { userId: 'a', currency: 'CNY', knownCost: 99, unknownCalls: 0 },
    { userId: 'a', currency: 'EUR', knownCost: 200, unknownCalls: 2 },
  ]);
  assert.deepEqual(report.alerts.map(row => [row.scope, row.currency, row.userId]), [['user', 'USD', 'a'], ['site', 'USD', null]]);
  assert.equal(report.unknownCostCalls, 3);
  assert.deepEqual(report.unbudgetedCurrencies, ['EUR']);
  assert.equal(report.alertsTruncated, false);
});

test('large alert list explicitly marks truncation', () => {
  const report = evaluateDailyBudgets({ USD: { user: 1 } }, Array.from({ length: 101 }, (_, i) => ({ userId: String(i), currency: 'USD', knownCost: 1, unknownCalls: 0 })));
  assert.equal(report.alerts.length, 100);
  assert.equal(report.alertsTruncated, true);
});

test('daily report uses UTC midnight, excludes mock and future calls, and preserves configuration failures', async () => {
  const previous = process.env.AI_DAILY_COST_BUDGETS;
  const now = new Date('2026-10-12T15:30:00Z');
  let reads = 0;
  const tx = { aiCall: { groupBy: async query => {
    reads++;
    assert.equal(query.where.startedAt.gte.toISOString(), '2026-10-12T00:00:00.000Z');
    assert.equal(query.where.startedAt.lte, now);
    assert.equal(query.where.status.not, 'MOCK');
    return [{ userId: 'a', currency: 'USD', _count: { _all: 2, estimatedCost: 1 }, _sum: { estimatedCost: 1 } }];
  } } };
  try {
    process.env.AI_DAILY_COST_BUDGETS = '';
    assert.equal((await readDailyBudgetReport(tx, now)).status, 'disabled');
    process.env.AI_DAILY_COST_BUDGETS = '{';
    assert.equal((await readDailyBudgetReport(tx, now)).status, 'invalid');
    assert.equal(reads, 0);
    process.env.AI_DAILY_COST_BUDGETS = '{"USD":{"site":1}}';
    const report = await readDailyBudgetReport(tx, now);
    assert.equal(report.status, 'enabled');
    assert.equal(report.alerts.length, 1);
    assert.equal(report.unknownCostCalls, 1);
  } finally {
    if (previous === undefined) delete process.env.AI_DAILY_COST_BUDGETS;
    else process.env.AI_DAILY_COST_BUDGETS = previous;
  }
});
