import test from 'node:test';
import assert from 'node:assert/strict';
import { readAiCostReport } from '../src/lib/ai/cost-report.ts';

test('per-thousand cost excludes mock calls, includes failed cost and keeps currencies separate', async () => {
  const since = new Date('2026-10-01T00:00:00Z'), until = new Date('2026-10-12T00:00:00Z');
  const tx = { aiCall: { groupBy: async query => {
    assert.deepEqual(query.where.startedAt, { gte: since, lte: until });
    return [
      { currency: 'CNY', status: 'SUCCEEDED', _count: { _all: 2, estimatedCost: 2 }, _sum: { estimatedCost: 3 } },
      { currency: 'CNY', status: 'FAILED', _count: { _all: 1, estimatedCost: 1 }, _sum: { estimatedCost: 0.6 } },
      { currency: 'CNY', status: 'MOCK', _count: { _all: 10, estimatedCost: 10 }, _sum: { estimatedCost: 0 } },
      { currency: 'USD', status: 'SUCCEEDED', _count: { _all: 1, estimatedCost: 0 }, _sum: { estimatedCost: null } },
      { currency: 'EUR', status: 'MOCK', _count: { _all: 1, estimatedCost: 1 }, _sum: { estimatedCost: 0 } },
    ];
  } } };
  const rows = await readAiCostReport(tx, since, until);
  assert.equal(rows.find(row => row.currency === 'CNY').realCalls, 3);
  assert.equal(rows.find(row => row.currency === 'CNY').costPerThousandCalls, 1200);
  assert.equal(rows.find(row => row.currency === 'USD').costPerThousandCalls, null);
  assert.equal(rows.find(row => row.currency === 'EUR').costPerThousandCalls, null);
});

test('no sample returns no invented cost', async () => {
  assert.deepEqual(await readAiCostReport({ aiCall: { groupBy: async () => [] } }, new Date()), []);
});
