import test from 'node:test';
import assert from 'node:assert/strict';
import {rmSync} from 'node:fs';
import path from 'node:path';

// Imported configuration services initialize the shared SQLite client even though
// report queries below use explicit fakes. Keep that initialization isolated too.
// 任务预算要读设置中心，所以这个库和 guard 测试一样按迁移建表，而不是空文件。
const file=`ai-budget-report-${process.pid}-${Date.now()}.db`,database=path.resolve('prisma',file);
process.env.DATABASE_URL=`file:./${file}`;
const {createIsolatedDatabase}=await import('../scripts/helpers/create-isolated-db.mjs');
createIsolatedDatabase(database);
const {parseDailyBudgets,evaluateDailyBudgets,readDailyBudgetReport}=await import('../src/lib/ai/budget-report.ts');
const {db,pragmasReady}=await import('../src/lib/db.ts');await pragmasReady;
test.after(async()=>{await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])rmSync(database+suffix,{force:true});});

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
  const tx = { aiModel:{findMany:async()=>[]},aiDailyCostBudget:{findMany:async()=>[]},aiCostPolicy:{findUnique:async()=>null},aiCall: { groupBy: async query => {
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

test('daily report combines attempt groups per account and excludes partial retry estimates', async () => {
  const original = process.env.AI_DAILY_COST_BUDGETS;
  process.env.AI_DAILY_COST_BUDGETS = '{"USD":{"site":1,"user":1}}';
  try {
    const tx = { aiModel:{findMany:async()=>[{id:'model-id',key:'unpriced-model'}]},aiModelPrice:{findMany:async()=>[]},aiDailyCostBudget:{findMany:async()=>[]},aiCostPolicy:{findUnique:async()=>null},aiCall: { groupBy: async query => {
      assert(query.by.includes('attempts'));
      return [
        { userId: 'a', currency: 'USD', attempts: 0, _count: { _all: 1, estimatedCost: 1 }, _sum: { estimatedCost: 0.4 } },
        { userId: 'a', currency: 'USD', attempts: 1, _count: { _all: 1, estimatedCost: 1 }, _sum: { estimatedCost: 0.6 } },
        { userId: 'a', currency: 'USD', attempts: 2, _count: { _all: 1, estimatedCost: 1 }, _sum: { estimatedCost: 0.9 } },
      ];
    } } };
    const report = await readDailyBudgetReport(tx, new Date());
    assert.equal(report.unknownCostCalls, 1);
    assert.equal(report.pricingConfigured,false);
    assert.deepEqual(report.pricingUnpricedModels,['unpriced-model']);
    assert.equal(report.alerts.length, 2);
    assert(report.alerts.every(row => row.knownCost === 1));
  } finally {
    if (original === undefined) delete process.env.AI_DAILY_COST_BUDGETS; else process.env.AI_DAILY_COST_BUDGETS = original;
  }
});

test('task budget keeps unset unlimited and treats zero or a reached limit as paused', async () => {
  const { taskBudgetBlock, TASK_LABELS } = await import('../src/lib/ai/task-budget.ts');
  assert.equal(taskBudgetBlock('story', null, []), null);
  assert.equal(taskBudgetBlock('chat', 2, [{ currency: 'USD', knownCost: 1, unknownCalls: 0 }]), null);
  const zero = taskBudgetBlock('mirrorAnonymous', 0, []);
  assert.equal(zero.code, 'AI_TASK_BUDGET');
  assert.equal(zero.status, 429);
  assert.equal(zero.scope, 'task');
  const reached = taskBudgetBlock('chat', 1, [{ currency: 'USD', knownCost: 1, unknownCalls: 0 }]);
  assert.equal(reached.code, 'AI_TASK_BUDGET');
  assert(reached.message.includes(TASK_LABELS.chat));
  // 未知成本不在任务层设卡：要不要拦住调用由全站预算那条链判断。
  assert.equal(taskBudgetBlock('chat', 1, [{ currency: 'USD', knownCost: 0.4, unknownCalls: 1 }]), null);
});

test('task report reads today usage per task and keeps the anonymous slice separate', async () => {
  const { readTaskBudgetReport } = await import('../src/lib/ai/task-budget.ts');
  const now = new Date('2026-10-12T15:30:00Z');
  const tx = { aiCall: { groupBy: async query => {
    assert.equal(query.where.startedAt.gte.toISOString(), '2026-10-12T00:00:00.000Z');
    assert.equal(query.where.startedAt.lte, now);
    assert.deepEqual(query.where.status.notIn, ['MOCK', 'STARTED']);
    if (query.by.includes('taskType')) {
      return [
        { taskType: 'mirror', currency: 'USD', attempts: 1, _count: { _all: 2, estimatedCost: 2 }, _sum: { estimatedCost: 0.5 } },
        { taskType: 'chat', currency: 'USD', attempts: 1, _count: { _all: 1, estimatedCost: 1 }, _sum: { estimatedCost: 0.25 } },
        { taskType: null, currency: 'USD', attempts: 1, _count: { _all: 1, estimatedCost: 0 }, _sum: { estimatedCost: null } },
      ];
    }
    assert.deepEqual(query.where.anonymousSubject, { not: null });
    return [{ currency: 'USD', attempts: 1, _count: { _all: 1, estimatedCost: 1 }, _sum: { estimatedCost: 0.2 } }];
  } } };
  const rows = await readTaskBudgetReport(tx, now);
  const byTask = Object.fromEntries(rows.map(row => [row.taskType, row]));
  assert.equal(rows.length, 6);
  assert.equal(byTask.chat.limit, null);
  assert.deepEqual(byTask.chat.usage, [{ currency: 'USD', knownCost: 0.25, unknownCalls: 0 }]);
  assert.deepEqual(byTask.mirror.usage, [{ currency: 'USD', knownCost: 0.5, unknownCalls: 0 }]);
  assert.deepEqual(byTask.mirrorAnonymous.usage, [{ currency: 'USD', knownCost: 0.2, unknownCalls: 0 }]);
  assert.deepEqual(byTask.story.usage, []);
});
