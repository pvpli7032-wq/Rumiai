import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import bcrypt from 'bcryptjs';

const enabled = Boolean(process.env.MEMBERSHIP_INTEGRATION_DB);
const it = enabled ? test : test.skip;
let db: import('@prisma/client').PrismaClient;
let sign: typeof import('@rumiai/backend/modules/payments/ezfp-v2').signEzfpParams;
let privateKey = '';
let server: Server;
let port = 0;
let api: {
  catalogue: typeof import('../../apps/api/src/app/api/memberships/route');
  checkout: typeof import('../../apps/api/src/app/api/memberships/checkout/route');
  notify: typeof import('../../apps/api/src/app/api/memberships/payments/ezfp/notify/route');
  current: typeof import('../../apps/api/src/app/api/me/membership/route');
  refund: typeof import('../../apps/api/src/app/api/me/membership/refund/route');
  refundPreview: typeof import('../../apps/api/src/app/api/me/membership/refund-preview/route');
  admin: typeof import('../../apps/api/src/app/api/admin/memberships/route');
};

function signed(fields: Record<string, string>) {
  const params = { ...fields, timestamp: String(Math.floor(Date.now() / 1000)), sign_type: 'RSA' };
  return { ...params, sign: sign(params, privateKey) };
}
async function json(response: Response) { return response.json() as Promise<Record<string, any>>; }
function request(url: string, init: RequestInit = {}) { return new Request(`http://localhost:3012${url}`, init); }

before(async () => {
  if (!enabled) return;
  process.env.DATABASE_URL = process.env.MEMBERSHIP_INTEGRATION_DB!.startsWith('file:') ? process.env.MEMBERSHIP_INTEGRATION_DB : `file:${process.env.MEMBERSHIP_INTEGRATION_DB}`;
  (process.env as Record<string, string>).NODE_ENV = 'test'; process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3012';
  process.env.EZFP_ENABLED = 'true'; process.env.EZFP_PID = '10001'; process.env.EZFP_REFUNDS_ENABLED = 'true';
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  process.env.EZFP_MERCHANT_PRIVATE_KEY = privateKey;
  process.env.EZFP_PLATFORM_PUBLIC_KEY = pair.publicKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const input = Object.fromEntries(new URLSearchParams(body));
    res.setHeader('content-type', 'application/json');
    if (req.url?.endsWith('/create')) res.end(JSON.stringify(signed({ code: '0', trade_no: `TRADE-${input.out_trade_no}`, pay_type: 'jump', pay_info: 'http://localhost:3012/fake-pay' })));
    else {
      const refundResponse = signed({ code: '0', trade_no: input.trade_no, out_refund_no: input.out_refund_no, money: input.money, refund_no: `REF-${input.out_refund_no}` });
      res.end(JSON.stringify({ ...refundResponse, code: 0 }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => { port = (server.address() as { port: number }).port; resolve(); }));
  process.env.EZFP_API_BASE_URL = `http://127.0.0.1:${port}`;
  const prisma = await import('@prisma/client'); db = new prisma.PrismaClient(); await db.$connect();
  await db.paymentCheckoutPolicy.upsert({ where: { id: 'primary' }, create: { id: 'primary', enabled: true }, update: { enabled: true } });
  ({ signEzfpParams: sign } = await import('@rumiai/backend/modules/payments/ezfp-v2'));
  api = {
    catalogue: await import('../../apps/api/src/app/api/memberships/route'),
    checkout: await import('../../apps/api/src/app/api/memberships/checkout/route'),
    notify: await import('../../apps/api/src/app/api/memberships/payments/ezfp/notify/route'),
    current: await import('../../apps/api/src/app/api/me/membership/route'),
    refund: await import('../../apps/api/src/app/api/me/membership/refund/route'),
    refundPreview: await import('../../apps/api/src/app/api/me/membership/refund-preview/route'),
    admin: await import('../../apps/api/src/app/api/admin/memberships/route'),
  };
});

after(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (db) await db.$disconnect(); });

it('public catalogue reads admin-configured month, quarter and annual plans; private route rejects anonymous users', async () => {
  const passwordHash = await bcrypt.hash('route-admin-password', 10);
  const admin = await db.user.create({ data: { username: `route-admin-${Date.now()}`, email: `route-admin-${Date.now()}@example.test`, passwordHash } });
  const { bootstrapOwner } = await import('@rumiai/backend/modules/admin/management-service'); await bootstrapOwner(admin.email);
  const { loginAdminWithPassword } = await import('@rumiai/backend/modules/admin-auth/service');
  const session = await loginAdminWithPassword({ email: admin.email, password: 'route-admin-password' });
  for (const [code, days, price] of [['MONTHLY', 30, 3000], ['QUARTERLY', 90, 8000], ['YEARLY', 365, 28000]] as const) {
    const existing = await db.membershipPlan.findUniqueOrThrow({ where: { code } });
    const response = await api.admin.PATCH(request('/api/admin/memberships', { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: `xingban_admin_session=${session.sessionToken}` }, body: JSON.stringify({ reason: 'route integration', id: existing.id, version: existing.version, code, name: code, durationDays: days, priceCents: price, benefits: [{ key: 'CHAT_PRICE_MULTIPLIER', label: '聊天折扣', value: 0.8 }], isActive: true }) }));
    assert.equal(response.status, 200, await response.text());
  }
  const adminCatalogue = await api.admin.GET(request('/api/admin/memberships', { headers: { cookie: `xingban_admin_session=${session.sessionToken}` } }));
  const adminBody = await json(adminCatalogue);
  const policyResponse = await api.admin.PATCH(request('/api/admin/memberships', { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: `xingban_admin_session=${session.sessionToken}` }, body: JSON.stringify({ kind: 'policy', reason: 'route policy integration', refundWindowHours: 12, usageChargePeriodHours: 24, version: adminBody.policy.version }) }));
  assert.equal(policyResponse.status, 200, JSON.stringify(await json(policyResponse)));
  const catalogue = await api.catalogue.GET(); const body = await json(catalogue);
  assert.deepEqual(body.plans.map((plan: { code: string }) => plan.code).sort(), ['MONTHLY', 'QUARTERLY', 'YEARLY']);
  assert.deepEqual(Object.fromEntries(body.plans.map((plan: { code: string; priceCents: number }) => [plan.code, plan.priceCents])), { MONTHLY: 3000, QUARTERLY: 8000, YEARLY: 28000 });
  assert.equal(body.policy.refundWindowHours, 12);
  assert.equal(body.policy.usageChargePeriodHours, 24);
  assert.equal((await api.current.GET(request('/api/me/membership'))).status, 401);
});

it('refund preview route distinguishes own pending/paid orders from another user and unknown orders', async () => {
  const suffix = `${Date.now()}${Math.random().toString(16).slice(2)}`;
  const owner = await db.user.create({ data: { username: `preview-owner-${suffix}`, email: `preview-owner-${suffix}@example.test`, passwordHash: 'integration-only' } });
  const stranger = await db.user.create({ data: { username: `preview-stranger-${suffix}`, email: `preview-stranger-${suffix}@example.test`, passwordHash: 'integration-only' } });
  const plan = await db.membershipPlan.findUniqueOrThrow({ where: { code: 'MONTHLY' } });
  const pending = await db.membershipOrder.create({ data: { orderNo: `PREVIEWPENDING${suffix}`, userId: owner.id, idempotencyKey: `preview-pending-${suffix}`, planId: plan.id, amountCents: 3000, durationDays: 30, refundWindowHours: 24, usageChargePeriodHours: 24, benefitsJson: plan.benefitsJson } });
  const paid = await db.membershipOrder.create({ data: { orderNo: `PREVIEWPAID${suffix}`, userId: owner.id, idempotencyKey: `preview-paid-${suffix}`, planId: plan.id, amountCents: 3000, durationDays: 30, refundWindowHours: 24, usageChargePeriodHours: 24, benefitsJson: plan.benefitsJson, status: 'PAID', paidAt: new Date() } });
  const ownerToken = await (await import('@rumiai/backend/infrastructure/auth/auth')).signToken({ userId: owner.id, email: owner.email });
  const strangerToken = await (await import('@rumiai/backend/infrastructure/auth/auth')).signToken({ userId: stranger.id, email: stranger.email });
  const pendingResponse = await api.refundPreview.GET(request(`/api/me/membership/refund-preview?orderNo=${pending.orderNo}`, { headers: { authorization: `Bearer ${ownerToken}` } }));
  assert.equal(pendingResponse.status, 409);
  const paidResponse = await api.refundPreview.GET(request(`/api/me/membership/refund-preview?orderNo=${paid.orderNo}`, { headers: { authorization: `Bearer ${ownerToken}` } }));
  assert.equal(paidResponse.status, 200);
  const strangerResponse = await api.refundPreview.GET(request(`/api/me/membership/refund-preview?orderNo=${paid.orderNo}`, { headers: { authorization: `Bearer ${strangerToken}` } }));
  assert.equal(strangerResponse.status, 404);
  const unknownResponse = await api.refundPreview.GET(request('/api/me/membership/refund-preview?orderNo=missing-route-order', { headers: { authorization: `Bearer ${ownerToken}` } }));
  assert.equal(unknownResponse.status, 404);
});

it('authenticated checkout, signed callback, billing settlement and refund route preserve ownership and idempotency', async () => {
  const suffix = `${Date.now()}${Math.random().toString(16).slice(2)}`;
  const passwordHash = await bcrypt.hash('route-user-password', 10);
  const user = await db.user.create({ data: { username: `route-user-${suffix}`, email: `route-user-${suffix}@example.test`, passwordHash, coins: 1000 } });
  const other = await db.user.create({ data: { username: `route-other-${suffix}`, email: `route-other-${suffix}@example.test`, passwordHash, coins: 1000 } });
  await db.membershipPlan.update({ where: { code: 'MONTHLY' }, data: { benefitsJson: JSON.stringify([{ key: 'CHAT_PRICE_MULTIPLIER', label: '聊天折扣', value: 1 }]) } });
  const { signToken } = await import('@rumiai/backend/infrastructure/auth/auth');
  const token = await signToken({ userId: user.id, email: user.email }); const otherToken = await signToken({ userId: other.id, email: other.email });
  const provider = await db.aiProvider.create({ data: { name: `route-provider-${suffix}`, baseUrl: 'http://127.0.0.1' } });
  const model = await db.aiModel.create({ data: { key: `route-model-${suffix}`, displayName: 'Route model', modelCode: 'route', providerId: provider.id, isActive: true, isDefault: true } });
  await db.modelCoinPrice.create({ data: { modelId: model.id, coinsPerReply: 100, effectiveAt: new Date(Date.now() - 1000), createdBy: user.id } });
  for (const [key, value] of Object.entries({ 'billing.chargingEnabled': true, 'billing.freeDailyMessages': 0, 'billing.dayTimezone': 'UTC', 'billing.priceMultiplier': 1200 })) await db.operationSetting.upsert({ where: { key }, create: { key, group: 'billing', value: JSON.stringify(value), updatedBy: user.id }, update: { value: JSON.stringify(value), updatedBy: user.id } });
  const monthlyPlan = await db.membershipPlan.findUniqueOrThrow({ where: { code: 'MONTHLY' } });
  const expiredAt = new Date(Date.now() - 31 * 86_400_000);
  const expiredPayment = await db.paymentOrder.create({ data: { orderNo: `EXPIREDPAY${suffix}`, idempotencyKey: `expired-payment-${suffix}`, userId: user.id, packageCoins: 0, packageBonus: 0, coinAmount: 0, amountCnyCents: 3000, status: 'PAID', providerTradeNo: `EXPIREDTRADE${suffix}`, paidAt: expiredAt } });
  const expiredOrder = await db.membershipOrder.create({ data: { orderNo: `EXPIREDMEM${suffix}`, userId: user.id, idempotencyKey: `expired-membership-${suffix}`, planId: monthlyPlan.id, paymentOrderId: expiredPayment.id, amountCents: 3000, durationDays: 30, refundWindowHours: 24, usageChargePeriodHours: 24, benefitsJson: monthlyPlan.benefitsJson, status: 'PAID', paidAt: expiredPayment.paidAt } });
  await db.membershipGrant.create({ data: { orderId: expiredOrder.id, userId: user.id, startsAt: expiredAt, expiresAt: new Date(expiredAt.getTime() + 30 * 86_400_000), benefitsJson: monthlyPlan.benefitsJson } });
  const expiredPreview = await api.refundPreview.GET(request(`/api/me/membership/refund-preview?orderNo=${expiredOrder.orderNo}`, { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(expiredPreview.status, 200); assert.equal((await json(expiredPreview)).eligible, false);
  const expiredRefund = await api.refund.POST(request('/api/me/membership/refund', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ orderNo: expiredOrder.orderNo }) }));
  assert.equal(expiredRefund.status, 409); assert.equal(await db.membershipRefund.count({ where: { orderId: expiredOrder.id } }), 0);
  const checkout = await api.checkout.POST(request('/api/memberships/checkout', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ planCode: 'MONTHLY', idempotencyKey: `route-${suffix}`, paymentMethod: 'alipay' }) }));
  const checkoutBody = await json(checkout); assert.equal(checkout.status, 200, JSON.stringify(checkoutBody)); const created = checkoutBody; assert.equal(created.amountCnyCents, 3000);
  const order = await db.membershipOrder.findUniqueOrThrow({ where: { orderNo: created.orderNo }, include: { paymentOrder: true } });
  const callback = signed({ out_trade_no: order.paymentOrder!.orderNo, trade_no: `TRADE-${order.paymentOrder!.orderNo}`, money: '30.00', pid: '10001', trade_status: 'TRADE_SUCCESS' });
  const callbackStartedAt = Date.now();
  const notifyUrl = `/api/memberships/payments/ezfp/notify?${new URLSearchParams(callback)}`;
  assert.equal((await api.notify.GET(request(notifyUrl))).status, 200); assert.equal((await api.notify.GET(request(notifyUrl))).status, 200);
  const monthlyGrant = await db.membershipGrant.findUniqueOrThrow({ where: { orderId: order.id } });
  assert.ok(Math.abs(monthlyGrant.startsAt.getTime() - callbackStartedAt) < 5_000);
  assert.equal(monthlyGrant.expiresAt.getTime() - monthlyGrant.startsAt.getTime(), 30 * 86_400_000);
  for (const [planCode, expectedDays] of [['QUARTERLY', 90], ['YEARLY', 365]] as const) {
    const renewal = await api.checkout.POST(request('/api/memberships/checkout', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ planCode, idempotencyKey: `${planCode.toLowerCase()}-${suffix}`, paymentMethod: 'alipay' }) }));
    const renewalBody = await json(renewal); assert.equal(renewal.status, 200, JSON.stringify(renewalBody));
    const renewalOrder = await db.membershipOrder.findUniqueOrThrow({ where: { orderNo: renewalBody.orderNo }, include: { paymentOrder: true } });
    const renewalCallback = signed({ out_trade_no: renewalOrder.paymentOrder!.orderNo, trade_no: `TRADE-${renewalOrder.paymentOrder!.orderNo}`, money: expectedDays === 90 ? '80.00' : '280.00', pid: '10001', trade_status: 'TRADE_SUCCESS' });
    assert.equal((await api.notify.GET(request(`/api/memberships/payments/ezfp/notify?${new URLSearchParams(renewalCallback)}`))).status, 200);
    const grant = await db.membershipGrant.findUniqueOrThrow({ where: { orderId: renewalOrder.id } });
    assert.equal(grant.expiresAt.getTime() - grant.startsAt.getTime(), expectedDays * 86_400_000);
  }
  const { holdCharge, settleCharge } = await import('@rumiai/backend/modules/billing/charge-service');
  const held = await holdCharge({ userId: user.id, requestId: `route-charge-${suffix}`, operation: 'CHAT_SEND', modelKey: model.key, requestContent: 'route integration' });
  assert.equal(held.coins, 100); await settleCharge({ userId: user.id, requestId: `route-charge-${suffix}`, operation: 'CHAT_SEND' });
  const wrong = await api.refund.POST(request('/api/me/membership/refund', { method: 'POST', headers: { authorization: `Bearer ${otherToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ orderNo: created.orderNo }) }));
  assert.equal(wrong.status, 404);
  const wrongPreview = await api.refundPreview.GET(request(`/api/me/membership/refund-preview?orderNo=${encodeURIComponent(created.orderNo)}`, { headers: { authorization: `Bearer ${otherToken}` } }));
  assert.equal(wrongPreview.status, 404);
  const refund = await api.refund.POST(request('/api/me/membership/refund', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ orderNo: created.orderNo }) }));
  const refundBody = await json(refund); assert.equal(refund.status, 200, JSON.stringify(refundBody)); assert.equal(refundBody.amountCents, 2900);
  const replay = await api.refund.POST(request('/api/me/membership/refund', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ orderNo: created.orderNo }) }));
  assert.equal(replay.status, 200); assert.equal((await db.membershipRefund.findUniqueOrThrow({ where: { orderId: order.id } })).status, 'COMPLETED');
  await db.membershipOrder.update({ where: { id: order.id }, data: { paidAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } });
  const expired = await api.refund.POST(request('/api/me/membership/refund', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ orderNo: created.orderNo }) }));
  assert.equal(expired.status, 200, 'completed refund is idempotent outside the original window');
});
