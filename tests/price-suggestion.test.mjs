import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

/**
 * 成本换算口径与建议币价（V3 §28）。
 *
 * 覆盖：四项齐备才出建议币价并向上取整、缺项说明缺哪项、汇率按生效时间判断、
 * 贡献毛利在汇率已配时算出、样本阈值来自设置而不是硬编码。
 */
const file = `price-suggestion-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);

const {suggestPrice, contributionMargin} = await import('../src/lib/ai/costs/price-suggestion.ts');
const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {readAdminCoinPrices} = await import('../src/lib/admin/coin-prices-admin.ts');
const {saveChanges} = await import('../src/lib/settings/service.ts');

const basis = (over = {}) => ({
  minSample: 30,
  targetMarginPercent: 60,
  coinUnitPriceCny: 0.1,
  coinUnitPriceNote: '标准 ¥10 / 100 币',
  exchange: {rate: 7, pendingRate: null, pendingEffectiveAt: null, effectiveAt: null},
  ...over,
});
const sample = (over = {}) => ({currency: 'USD', calls: 40, knownCostCalls: 40, estimatedCost: 0.4, ...over});

test('四项齐备：成本 → 汇率 → 目标收入 → 币，向上取整到 1 币', () => {
  // 每条成本 0.4/40 = 0.01 USD → ×7 = 0.07 CNY → ÷(1−60%) = 0.175 → ÷0.1 = 1.75 币 → 2 币
  const outcome = suggestPrice({sample: sample(), basis: basis()});
  assert.equal(outcome.kind, 'suggested');
  assert.equal(outcome.coins, 2);
  assert.ok(Math.abs(outcome.costCny - 0.07) < 1e-9);
  assert.ok(Math.abs(outcome.revenueCny - 0.175) < 1e-9);
});

test('缺项不编数字：样本不足、汇率缺失、目标毛利未设、套餐价格未配置各自说清楚', () => {
  const lowSample = suggestPrice({sample: sample({calls: 12, knownCostCalls: 12}), basis: basis()});
  assert.equal(lowSample.kind, 'missing');
  assert.ok(lowSample.reasons.includes('样本不足 12/30'), lowSample.reasons.join('；'));

  const noRate = suggestPrice({sample: sample(), basis: basis({exchange: {rate: null, pendingRate: null, pendingEffectiveAt: null, effectiveAt: null}})});
  assert.equal(noRate.kind, 'missing');
  assert.ok(noRate.reasons.includes('待填写汇率'));

  const noMargin = suggestPrice({sample: sample(), basis: basis({targetMarginPercent: null})});
  assert.equal(noMargin.kind, 'missing');
  assert.ok(noMargin.reasons.includes('未设目标毛利'));

  const noUnit = suggestPrice({sample: sample(), basis: basis({coinUnitPriceCny: null})});
  assert.equal(noUnit.kind, 'missing');
  assert.ok(noUnit.reasons.includes('套餐人民币价格待配置'));

  // 阈值可改：样本阈值调低到 10 后，12 条样本就够。
  assert.equal(suggestPrice({sample: sample({calls: 12, knownCostCalls: 12}), basis: basis({minSample: 10})}).kind, 'suggested');
});

test('汇率待生效时用旧值，并说明生效时间', () => {
  const pending = suggestPrice({sample: sample(), basis: basis({exchange: {rate: null, pendingRate: 8, pendingEffectiveAt: '2027-01-01T00:00:00.000Z', effectiveAt: null}})});
  assert.equal(pending.kind, 'missing');
  assert.ok(pending.reasons.some(reason => reason.includes('待填写汇率') && reason.includes('起生效')), pending.reasons.join('；'));
});

test('成本币本身是人民币时不再乘汇率', () => {
  const cny = suggestPrice({sample: sample({currency: 'CNY'}), basis: basis({exchange: {rate: 7, pendingRate: null, pendingEffectiveAt: null, effectiveAt: null}})});
  assert.equal(cny.kind, 'suggested');
  // 0.01 CNY → ÷(1−60%) = 0.025 → ÷0.1 = 0.25 → 1 币
  assert.equal(cny.coins, 1);
});

test('贡献毛利：汇率已配时算百分比，未配时只说缺什么', () => {
  const margin = contributionMargin({sample: sample(), coinPriceCoins: 3, basis: basis()});
  assert.equal(margin.kind, 'margin');
  // 收入 3 币 × 0.1 = 0.30；成本 0.07 → (0.30−0.07)/0.30 = 76.67%
  assert.ok(Math.abs(margin.percent - 76.6667) < 0.01);

  const noRate = contributionMargin({sample: sample(), coinPriceCoins: 3, basis: basis({exchange: {rate: null, pendingRate: null, pendingEffectiveAt: null, effectiveAt: null}})});
  assert.equal(noRate.kind, 'missing');
  assert.ok(noRate.reasons.includes('待填写汇率'));
});

test('价格页口径：最小样本来自设置中心，汇率按生效时间取旧值', async () => {
  const provider = await db.aiProvider.create({data: {name: '合成供应商', baseUrl: 'https://example.invalid/v1'}});
  await db.aiModel.create({data: {key: 'suggest-model', displayName: '建议价模型', modelCode: 'gpt-x', isActive: true, providerId: provider.id}});
  await db.coinPackage.create({data: {id: 'pkg-100', label: '标准', coins: 100, priceCnyCents: 1000, bonus: 0, priceThb: 0}});

  const fresh = await readAdminCoinPrices();
  assert.equal(fresh.pricing.minSample, 30, '默认 30，不是硬编码 5');
  assert.equal(fresh.pricing.exchange.rate, null, '没填汇率时不给汇率');
  assert.equal(fresh.pricing.coinUnitPriceCny, 0.1, '每币单价按套餐实发币数折算');

  await saveChanges({
    changes: [
      {key: 'cost.suggestedPriceMinSample', value: 12},
      {key: 'cost.exchangeRate', value: 7.2},
      {key: 'cost.exchangeRateEffectiveAt', value: '2099-01-01T00:00:00.000Z'},
    ],
    expectedVersions: {},
    operatorId: 'test-operator',
  });
  const pending = await readAdminCoinPrices();
  assert.equal(pending.pricing.minSample, 12, '阈值改成设置值');
  assert.equal(pending.pricing.exchange.rate, null, '生效时间未到：没有可用的当前汇率');
  assert.equal(pending.pricing.exchange.pendingRate, 7.2);
  assert.equal(pending.pricing.exchange.pendingEffectiveAt, '2099-01-01T00:00:00.000Z');

  // 生效时间改为过去：立即生效。
  await saveChanges({
    changes: [{key: 'cost.exchangeRateEffectiveAt', value: '2020-01-01T00:00:00.000Z'}],
    expectedVersions: {},
    operatorId: 'test-operator',
  });
  const active = await readAdminCoinPrices();
  assert.equal(active.pricing.exchange.rate, 7.2);
  assert.equal(active.pricing.exchange.pendingRate, null);
  assert.equal(active.pricing.exchange.effectiveAt, '2020-01-01T00:00:00.000Z');

  // 换一个更晚的生效时间：当前汇率退回上一版，新值只作为待生效。
  await saveChanges({
    changes: [{key: 'cost.exchangeRateEffectiveAt', value: '2099-06-01T00:00:00.000Z'}],
    expectedVersions: {},
    operatorId: 'test-operator',
  });
  const rolledBack = await readAdminCoinPrices();
  assert.equal(rolledBack.pricing.exchange.rate, null, '到点前不生效：退回改动前的汇率（此前未登记，即为空）');
  assert.equal(rolledBack.pricing.exchange.pendingRate, 7.2);
});

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});
