import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';

const enabled = Boolean(process.env.MEMBERSHIP_INTEGRATION_DB);
const it = enabled ? test : test.skip;
let db: import('@prisma/client').PrismaClient;
let createCreatorCharacter: typeof import('@rumiai/backend/modules/characters/creator-service').createCreatorCharacter;
let clearKeyEverywhere: typeof import('@rumiai/backend/modules/settings/cache').clearKeyEverywhere;

before(async () => {
  if (!enabled) return;
  const p = process.env.MEMBERSHIP_INTEGRATION_DB!;
  process.env.DATABASE_URL = p.startsWith('file:') ? p : `file:${p}`;
  const prisma = await import('@prisma/client');
  db = new prisma.PrismaClient();
  await db.$connect();
  ({createCreatorCharacter} = await import('@rumiai/backend/modules/characters/creator-service'));
  ({clearKeyEverywhere} = await import('@rumiai/backend/modules/settings/cache'));
});

after(async () => {if (db) await db.$disconnect();});

async function cap(value: number) {
  await db.operationSetting.upsert({where: {key: 'content.character.maxOwned'}, create: {key: 'content.character.maxOwned', group: 'chat', value: String(value), version: 1, updatedBy: 'membership-test'}, update: {value: String(value), version: {increment: 1}, updatedBy: 'membership-test'}});
  clearKeyEverywhere('content.character.maxOwned');
}

async function userFixture(limit: number | null, state: 'ACTIVE'|'EXPIRED'|'REFUNDED' = 'ACTIVE') {
  const suffix = `${Date.now()}${Math.random().toString(16).slice(2)}`.replace(/[^a-z0-9]/gi, '').slice(0, 24);
  const user = await db.user.create({data: {username: `mc${suffix}`, email: `mc${suffix}@example.test`, passwordHash: 'integration-only'}});
  if (limit !== null) {
    const plan = await db.membershipPlan.create({data: {code: `MC${suffix}`.toUpperCase(), name: '角色总上限会员', durationDays: 30, priceCents: 3000, benefitsJson: JSON.stringify([{key: 'CHARACTER_CREATE_LIMIT', label: '角色总上限', value: limit}]), isActive: true}});
    const order = await db.membershipOrder.create({data: {orderNo: `MCO${suffix}`.toUpperCase(), userId: user.id, idempotencyKey: `mci-${suffix}`, planId: plan.id, amountCents: 3000, durationDays: 30, refundWindowHours: 24, usageChargePeriodHours: 24, benefitsJson: plan.benefitsJson, status: 'PAID', paidAt: new Date()}});
    await db.membershipGrant.create({data: {orderId: order.id, userId: user.id, startsAt: state === 'ACTIVE' ? new Date(Date.now() - 1000) : new Date(Date.now() - 86400000), expiresAt: state === 'EXPIRED' ? new Date(Date.now() - 1000) : new Date(Date.now() + 86400000), benefitsJson: plan.benefitsJson, status: state === 'REFUNDED' ? 'REVOKED' : 'ACTIVE'}});
    if (state === 'REFUNDED') await db.membershipRefund.create({data: {orderId: order.id, amountCents: 3000, deductedCents: 0, reason: 'test', status: 'PENDING'}});
  }
  return user;
}

function body(i: number) { return {name: `测试角色${i}`, personality: '测试人设'}; }

it('default public cap 0 keeps non-members unlimited and cannot be worsened by membership', async () => {
  await cap(0);
  const user = await userFixture(null);
  await createCreatorCharacter(user.id, body(1));
  await createCreatorCharacter(user.id, body(2));
  assert.equal(await db.character.count({where: {creatorId: user.id}}), 2);
});

it('public cap applies to everyone; membership total cap extends it and consumes only above public cap', async () => {
  await cap(2);
  const user = await userFixture(4);
  await createCreatorCharacter(user.id, body(1));
  await createCreatorCharacter(user.id, body(2));
  assert.equal(await db.membershipUsage.count({where: {userId: user.id}}), 0);
  await createCreatorCharacter(user.id, body(3));
  await createCreatorCharacter(user.id, body(4));
  assert.equal(await db.character.count({where: {creatorId: user.id}}), 4);
  assert.equal(await db.membershipUsage.count({where: {userId: user.id, benefitCode: 'CHARACTER_CREATE_LIMIT'}}), 2);
  await assert.rejects(() => createCreatorCharacter(user.id, body(5)), {status: 403});
});

it('expired or pending-refund membership falls back to public cap', async () => {
  await cap(2);
  for (const state of ['EXPIRED', 'REFUNDED'] as const) {
    const user = await userFixture(4, state);
    await createCreatorCharacter(user.id, body(1));
    await createCreatorCharacter(user.id, body(2));
    await assert.rejects(() => createCreatorCharacter(user.id, body(3)), {status: 403});
  }
});

it('concurrent creations never exceed the effective total cap', async () => {
  await cap(2);
  const user = await userFixture(3);
  const results = await Promise.allSettled([1, 2, 3, 4].map(i => createCreatorCharacter(user.id, body(i))));
  assert.ok(results.some(row => row.status === 'rejected'));
  assert.ok(await db.character.count({where: {creatorId: user.id}}) <= 3);
});
