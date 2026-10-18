import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import path from 'node:path';
import { rmSync } from 'node:fs';

const root = process.cwd();
const databaseFile = `m4-ezfp-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${databaseFile}`;
test.after(async () => {
  const { db: routeDb, pragmasReady } = await import('../src/lib/db.ts');
  await pragmasReady;
  await routeDb.$disconnect();
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    rmSync(path.join(root, 'prisma', databaseFile + suffix), { force: true });
  }
});
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = `local-ezfp-test-${process.pid}-${Date.now()}`;
process.env.OPENAI_API_KEY = '';
process.env.DISABLE_MOCK_AI = 'true';
process.env.ALLOW_SIMULATED_PURCHASES = 'false';

const migrationEnv = { ...process.env };
// A machine-level RUST_LOG=warn can make the Windows Prisma schema engine fail
// with an opaque startup error. Keep this isolated test independent of that setting.
delete migrationEnv.RUST_LOG;
const migration = spawnSync(process.execPath, [
  path.join(root, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy',
  '--schema', path.join(root, 'prisma', 'schema.prisma'),
], { cwd: root, env: migrationEnv, encoding: 'utf8' });
if (migration.status !== 0) {
  throw new Error(`Isolated EZFP migration failed:\n${migration.stdout}\n${migration.stderr}`);
}

const { privateKey: merchantPrivate, publicKey: merchantPublic } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const { privateKey: platformPrivate, publicKey: platformPublic } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
process.env.EZFP_ENABLED = 'true';
process.env.EZFP_REFUNDS_ENABLED = 'true';
process.env.EZFP_PID = '9101001';
process.env.EZFP_MERCHANT_PRIVATE_KEY = merchantPrivate;
process.env.EZFP_PLATFORM_PUBLIC_KEY = platformPublic;
process.env.NEXT_PUBLIC_SITE_URL = 'http://127.0.0.1:18799';

const { PrismaClient } = await import('@prisma/client');
const { signToken } = await import('../src/lib/auth.ts');
const {bootstrapOwner}=await import('../src/lib/admin/management-service.ts');
const { GET: getPackages } = await import('../src/app/api/coins/packages/route.ts');
const { POST: createOrder } = await import('../src/app/api/coins/orders/route.ts');
const { GET: getOrder } = await import('../src/app/api/coins/orders/[orderNo]/route.ts');
const { GET: notify } = await import('../src/app/api/coins/payments/ezfp/notify/route.ts');
const { POST: refund } = await import('../src/app/api/admin/finance/orders/[orderNo]/refund/route.ts');
const {GET:callbackAlerts}=await import('../src/app/api/admin/finance/callback-alerts/route.ts');
const { signEzfpParams, verifyEzfpParams } = await import('../src/lib/payments/ezfp-v2.ts');

const db = new PrismaClient();
let providerRequestCount = 0;
let capturedRequest = null;
let refundOutcome = 'success';
let queryStatus = 1;
let lastRefundParams = null;
const provider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const params = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
  providerRequestCount++;
  if (new URL(request.url, 'http://localhost').pathname === '/api/pay/create' && !['alipay', 'wxpay'].includes(params.type)) {
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.end(JSON.stringify({code: -1, msg: '缺少支付方式'}));
    return;
  }
  capturedRequest = params;
  if (!verifyEzfpParams(params, merchantPublic) || params.sign_type !== 'RSA') {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ code: 1, msg: 'request signature invalid' }));
    return;
  }
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/api/pay/refund') {
    lastRefundParams = params;
    if (refundOutcome === 'network') { request.socket.destroy(); return; }
    const result = refundOutcome === 'success'
      ? { code: 0, msg: '退款成功', refund_no: `REF-${params.out_refund_no}`, out_refund_no: params.out_refund_no, trade_no: params.trade_no, money: params.money, reducemoney: params.money, timestamp: String(Math.floor(Date.now() / 1000)), sign_type: 'RSA' }
      : { code: 1, msg: 'test rejection', timestamp: String(Math.floor(Date.now() / 1000)), sign_type: 'RSA' };
    result.sign = signEzfpParams(result, platformPrivate);
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result)); return;
  }
  if (path === '/api/pay/query') {
    const result = { code: 0, trade_no: params.trade_no, out_trade_no: params.out_trade_no, api_trade_no: 'LOCAL-API-ORDER', type: 'alipay', status: queryStatus, pid: params.pid, money: '1.25', timestamp: String(Math.floor(Date.now() / 1000)), sign_type: 'RSA' };
    result.sign = signEzfpParams(result, platformPrivate);
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result)); return;
  }
  const result = {
    code: 0,
    trade_no: `EZFP-${params.out_trade_no}`,
    pay_type: 'jump',
    pay_info: `https://pay.ezfp.test/${params.out_trade_no}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
    sign_type: 'RSA',
  };
  result.sign = signEzfpParams(result, platformPrivate);
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(result));
});

await new Promise((resolve, reject) => {
  provider.once('error', reject);
  provider.listen(0, '127.0.0.1', resolve);
});
process.env.EZFP_API_BASE_URL = `http://127.0.0.1:${provider.address().port}`;
process.env.NEXT_PUBLIC_SITE_URL = 'http://127.0.0.1:18799';

function webRequest(pathname, { method = 'GET', token, body } = {}) {
  return new Request(`http://127.0.0.1:18799${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function notificationUrl(fields) {
  const params = { ...fields, sign_type: 'RSA' };
  params.sign = signEzfpParams(params, platformPrivate);
  const query = new URLSearchParams(params);
  return `http://127.0.0.1:18799/api/coins/payments/ezfp/notify?${query}`;
}

test('EZFP order creation and signed callback credit a package exactly once', async (t) => {
  try {
    const now = Date.now();
    const user = await db.user.create({
      data: {
        username: `ezfp_${now}`,
        email: `ezfp_${now}@example.invalid`,
        passwordHash: 'test-only',
      },
    });
    const token = await signToken({ userId: user.id, email: user.email, tokenVersion: user.tokenVersion });
    const approver=await db.user.create({data:{username:`refund_approver_${now}`,email:`refund-approver-${now}@example.invalid`,passwordHash:'test-only'}});
    await bootstrapOwner(approver.email);
    const approverToken=await signToken({userId:approver.id,email:approver.email,tokenVersion:approver.tokenVersion});
    const pkg = await db.coinPackage.create({
      data: { id: `ezfp-package-${now}`, coins: 100, bonus: 25, priceThb: 999, priceCnyCents: 125, label: 'isolated EZFP test' },
    });

    const packageResponse = await getPackages();
    assert.equal(packageResponse.status, 200);
    assert.ok(Array.isArray(await packageResponse.clone().json()));
    assert.equal(packageResponse.headers.get('X-Checkout-Enabled'), 'true');
    const before = (await db.user.findUniqueOrThrow({ where: { id: user.id } })).coins;
    const idempotencyKey = randomUUID();
    const createResponse = await createOrder(webRequest('/api/coins/orders', {
      method: 'POST', token,
      // Client-supplied price and coin fields must be ignored; the DB package wins.
      body: { packageId: pkg.id, idempotencyKey, amountCnyCents: 1, coins: 999999 },
    }));
    assert.equal(createResponse.status, 200, await createResponse.clone().text());
    const created = await createResponse.json();
    assert.equal(created.status, 'PENDING');
    assert.equal(created.amountCnyCents, 125);
    assert.equal(created.coinAmount, 125);
    assert.match(created.redirectUrl, /^https:\/\/pay\.ezfp\.test\//);
    assert.equal(providerRequestCount, 1);
    assert.equal(capturedRequest.money, '1.25');
    assert.equal(capturedRequest.type, 'alipay');
    assert.equal(capturedRequest.method, 'jump');
    assert.equal(capturedRequest.pid, '9101001');
    assert.equal(verifyEzfpParams(capturedRequest, merchantPublic), true);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).coins, before);

    const duplicateRequest = await createOrder(webRequest('/api/coins/orders', {
      method: 'POST', token, body: { packageId: pkg.id, idempotencyKey },
    }));
    assert.equal(duplicateRequest.status, 200);
    assert.equal((await duplicateRequest.json()).orderNo, created.orderNo);
    assert.equal(providerRequestCount, 1);

    const statusResponse = await getOrder(webRequest(`/api/coins/orders/${created.orderNo}`, { token }), { params: { orderNo: created.orderNo } });
    assert.equal(statusResponse.status, 200);
    assert.equal((await statusResponse.json()).status, 'PENDING');
    assert.equal((await getOrder(webRequest(`/api/coins/orders/${created.orderNo}`), { params: { orderNo: created.orderNo } })).status, 401);

    const baseFields = {
      pid: '9101001',
      trade_no: `EZFP-${created.orderNo}`,
      out_trade_no: created.orderNo,
      api_trade_no: 'LOCAL-MOCK-SETTLEMENT',
      type: 'alipay',
      trade_status: 'TRADE_SUCCESS',
      money: '1.25',
      timestamp: String(Math.floor(Date.now() / 1000)),
      name: '金币充值 125 枚',
    };
    const wrongAmount = await notify(new Request(notificationUrl({ ...baseFields, money: '1.24' })));
    assert.equal(wrongAmount.status, 400);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).coins, before);
    const rejectedCallback = await db.paymentCallbackEvent.findFirst({ where: { paymentOrder: { orderNo: created.orderNo }, outcome: 'REJECTED' } });
    assert.equal(rejectedCallback.reasonCode, 'amount_mismatch');

    const tamperedUrl = notificationUrl(baseFields).replace('money=1.25', 'money=9.99');
    assert.equal((await notify(new Request(tamperedUrl))).status, 400);
    assert.equal((await notify(new Request(tamperedUrl))).status,400);
    assert.equal(await db.paymentCallbackEvent.count({ where: { paymentOrder: { orderNo: created.orderNo } } }), 1, 'unverified payloads are not persisted');
    const callbackAlertResponse=await callbackAlerts(webRequest('/api/admin/finance/callback-alerts?hours=24',{token:approverToken}));assert.equal(callbackAlertResponse.status,200);const callbackAlertData=await callbackAlertResponse.json();assert.equal(callbackAlertData.reasons.find(row=>row.reasonCode==='signature_or_timestamp').sampledMinutes,1);assert.equal(JSON.stringify(callbackAlertData).includes(created.orderNo),false);

    const signedCallback = notificationUrl(baseFields);
    const acknowledgements = await Promise.all(Array.from({ length: 4 }, () => notify(new Request(signedCallback))));
    const acknowledgementBodies = await Promise.all(acknowledgements.map((response) => response.text()));
    assert.ok(acknowledgements.every((response) => response.status === 200), acknowledgementBodies.join(','));
    assert.ok(acknowledgementBodies.every((body) => body === 'success'));
    const after = (await db.user.findUniqueOrThrow({ where: { id: user.id } })).coins;
    assert.equal(after - before, 125);
    const order = await db.paymentOrder.findUniqueOrThrow({ where: { orderNo: created.orderNo } });
    assert.equal(order.status, 'PAID');
    assert.equal(await db.coinTransaction.count({ where: { paymentOrderId: order.id } }), 1);
    const callbackEvents = await db.paymentCallbackEvent.findMany({ where: { paymentOrderId: order.id }, orderBy: { receivedAt: 'asc' } });
    assert.equal(callbackEvents.length, 5);
    assert.equal(callbackEvents.filter(event => event.outcome === 'SETTLED').length, 1);
    assert.equal(callbackEvents.filter(event => event.outcome === 'DUPLICATE').length, 3);
    assert.equal(callbackEvents.filter(event => event.outcome === 'REJECTED').length, 1);
    assert.equal(JSON.stringify(callbackEvents).includes('api_trade_no'), false);
    const settledStatus = await getOrder(webRequest(`/api/coins/orders/${created.orderNo}`, { token }), { params: { orderNo: created.orderNo } });
    assert.equal((await settledStatus.json()).status, 'PAID');

    const paidRetry = await createOrder(webRequest('/api/coins/orders', {
      method: 'POST', token, body: { packageId: pkg.id, idempotencyKey },
    }));
    assert.equal((await paidRetry.json()).status, 'PAID');
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).coins, after);
    await t.test('finance report requires separate permission and detects ledger/cost gaps without writes', async () => {
      const { GET: report } = await import('../src/app/api/admin/finance/report/route.ts');
      delete process.env.PAYMENT_ADMIN_USER_IDS;
      process.env.MODERATOR_USER_IDS = user.id;
      assert.equal((await report(webRequest('/api/admin/finance/report'))).status, 401);
      assert.equal((await report(webRequest('/api/admin/finance/report', { token }))).status, 403);
      process.env.PAYMENT_ADMIN_USER_IDS = user.id;
      assert.equal((await report(webRequest('/api/admin/finance/report?days=NaN', { token }))).status, 400);
      assert.equal((await report(webRequest('/api/admin/finance/report?days=91', { token }))).status, 400);
      const clean = await report(webRequest('/api/admin/finance/report?days=7', { token }));
      assert.equal(clean.headers.get('cache-control'), 'private, no-store');
      assert.equal((await clean.json()).orderAnomalies.length, 0);
      const broken = await db.paymentOrder.create({ data: {
        orderNo: `BROKEN${now}`, idempotencyKey: randomUUID(), userId: user.id,
        packageCoins: 50, packageBonus: 0, coinAmount: 50, amountCnyCents: 100,
        status: 'PAID', paidAt: new Date(),
      } });
      const negative = await db.user.create({ data: { username: `negative_${now}`, email: `negative_${now}@example.invalid`, passwordHash: 'test-only', coins: -1 } });
      await db.aiCall.createMany({ data: [
        { userId: user.id, conversationId: 'fixture', operation: 'SEND', startedAt: new Date(), status: 'SUCCEEDED', currency: 'USD', estimatedCost: 0.2 },
        { userId: user.id, conversationId: 'fixture', operation: 'SEND', startedAt: new Date(), status: 'FAILED', currency: 'USD', estimatedCost: null },
        { userId: user.id, conversationId: 'fixture', operation: 'SEND', startedAt: new Date(), status: 'MOCK', currency: 'USD', estimatedCost: 0 },
        { userId: user.id, conversationId: 'fixture', operation: 'SEND', startedAt: new Date(), status: 'SUCCEEDED', currency: 'CNY', estimatedCost: 1.5 },
      ] });
      const rowsBefore = await db.coinTransaction.count();
      process.env.AI_DAILY_COST_BUDGETS = '{"USD":{"site":0.1,"user":0.2}}';
      const data = await (await report(webRequest('/api/admin/finance/report?days=7', { token }))).json();
      assert.equal(data.aiBudget.status, 'enabled');
      assert.equal(data.aiBudget.alerts.length, 2);
      assert.equal(data.aiBudget.unknownCostCalls, 1);
      assert.deepEqual(data.aiBudget.unbudgetedCurrencies, ['CNY']);
      delete process.env.AI_DAILY_COST_BUDGETS;
      assert.equal(data.paidOrders, 2);
      assert.equal(data.paidAmountCnyCents, 225);
      assert.equal(data.orderAnomalies[0].orderNo, broken.orderNo);
      assert.equal(data.orderAnomalies[0].actualCoins, null);
      assert.equal(data.negativeBalances[0].id, negative.id);
      const usd = data.aiCosts.find(row => row.currency === 'USD');
      assert.equal(usd.estimatedCost, 0.2);
      assert.equal(usd.unknownCostCalls, 1);
      assert.equal(usd.mockCalls, 1);
      assert.equal(usd.failedCalls, 1);
      assert.equal(data.aiCosts.find(row => row.currency === 'CNY').estimatedCost, 1.5);
      assert.equal(usd.costPerThousandCalls, null);
      assert.equal(data.aiCosts.find(row => row.currency === 'CNY').costPerThousandCalls, 1500);
      assert.equal(data.validationMetrics.paidOrderCount, 2);
      assert.equal(data.validationMetrics.payingNewUsers, 1, 'two orders by one buyer count once');
      assert.equal(data.validationMetrics.paidOrderRefundRate, 0);
      assert.equal(data.validationMetrics.grossMarginRate, null);
      const { readPaymentValidationMetrics } = await import('../src/lib/payments/validation-metrics.ts');
      const emptyMetrics = await readPaymentValidationMetrics(db, new Date('2000-01-01'), new Date('2000-01-02'));
      assert.equal(emptyMetrics.newUserPaymentRate, null);
      assert.equal(emptyMetrics.paidOrderRefundRate, null);
      await db.coinTransaction.create({ data: { userId: user.id, paymentOrderId: broken.id, type: 'PURCHASE', amount: 49 } });
      assert.equal((await (await report(webRequest('/api/admin/finance/report', { token }))).json()).orderAnomalies[0].actualCoins, 49);
      await db.coinTransaction.update({ where: { paymentOrderId: broken.id }, data: { amount: 50 } });
      assert.equal((await (await report(webRequest('/api/admin/finance/report', { token }))).json()).orderAnomalies.length, 0);
      assert.equal((await (await report(webRequest('/api/admin/finance/report', { token }))).json()).refundAnomalies.length, 0);
      await db.paymentOrder.update({ where: { id: broken.id }, data: { status: 'PENDING' } });
      assert.equal((await (await report(webRequest('/api/admin/finance/report', { token }))).json()).orderAnomalies.length, 1);
      assert.equal(await db.coinTransaction.count(), rowsBefore + 1);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).coins, after);
    });
    await t.test('full refund reserves coins, returns them only on signed rejection, and reuses one refund number after uncertainty', async () => {
      process.env.PAYMENT_ADMIN_USER_IDS = user.id;
      process.env.EZFP_REFUNDS_ENABLED = 'true';
      const makePaidOrder = async (label, coins) => {
        const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`;
        const owner = await db.user.create({ data: { username: `${label}_${stamp}`, email: `${label}_${stamp}@example.invalid`, passwordHash: 'test-only', coins } });
        const payment = await db.paymentOrder.create({ data: { orderNo: `TEST${stamp.replace(/[^A-Z0-9]/gi, '').toUpperCase()}`, idempotencyKey: randomUUID(), userId: owner.id, packageCoins: 100, packageBonus: 25, coinAmount: 125, amountCnyCents: 125, providerTradeNo: `EZFP-TEST-${stamp}` , status: 'PAID', paidAt: new Date() } });
        await db.coinTransaction.create({ data: { userId: owner.id, paymentOrderId: payment.id, amount: 125, type: 'PURCHASE' } });
        const jwt = await signToken({ userId: owner.id, email: owner.email, tokenVersion: owner.tokenVersion });
        return { owner, payment, jwt };
      };
      const poor = await makePaidOrder('poor', 10);
      process.env.PAYMENT_ADMIN_USER_IDS = poor.owner.id;
      const { GET: refundOrders } = await import('../src/app/api/admin/finance/orders/route.ts');
      assert.equal((await refundOrders(webRequest('/api/admin/finance/orders'))).status, 401);
      assert.equal((await refundOrders(webRequest('/api/admin/finance/orders', { token }))).status, 403);
      process.env.EZFP_REFUNDS_ENABLED = 'false';
      const disabled = await refund(webRequest(`/api/admin/finance/orders/${poor.payment.orderNo}/refund`, { method: 'POST', token: poor.jwt, body: { action: 'refund', reason: 'test' } }), { params: { orderNo: poor.payment.orderNo } });
      assert.equal(disabled.status, 503);
      process.env.EZFP_REFUNDS_ENABLED = 'true';
      const requestCount = providerRequestCount;
      const poorResult = await refund(webRequest(`/api/admin/finance/orders/${poor.payment.orderNo}/refund`, { method: 'POST', token: poor.jwt, body: { action: 'refund', reason: 'test' } }), { params: { orderNo: poor.payment.orderNo } });
      assert.equal(poorResult.status, 409);
      assert.equal(providerRequestCount, requestCount, 'insufficient balance must not call the payment provider');
      assert.equal(await db.paymentRefund.count({ where: { paymentOrderId: poor.payment.id } }), 0);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: poor.owner.id } })).coins, 10);

      const internallyRejected=await makePaidOrder('internalreject',500);process.env.PAYMENT_ADMIN_USER_IDS=internallyRejected.owner.id;
      const internalRequest=await refund(webRequest(`/api/admin/finance/orders/${internallyRejected.payment.orderNo}/refund`,{method:'POST',token:internallyRejected.jwt,body:{action:'request',reason:'客户申请撤销'}}),{params:{orderNo:internallyRejected.payment.orderNo}});assert.equal(internalRequest.status,201);
      const callsBeforeReject=providerRequestCount;
      const internalReject=await refund(webRequest(`/api/admin/finance/orders/${internallyRejected.payment.orderNo}/refund`,{method:'POST',token:approverToken,body:{action:'reject',reason:'不符合退款条件'}}),{params:{orderNo:internallyRejected.payment.orderNo}});assert.equal(internalReject.status,200);assert.equal((await internalReject.json()).status,'REJECTED');
      assert.equal(providerRequestCount,callsBeforeReject,'approval rejection must not contact provider');assert.equal((await db.paymentOrder.findUniqueOrThrow({where:{id:internallyRejected.payment.id}})).status,'PAID');assert.equal((await db.user.findUniqueOrThrow({where:{id:internallyRejected.owner.id}})).coins,500);
      const internalRejectedRefund=await db.paymentRefund.findUniqueOrThrow({where:{paymentOrderId:internallyRejected.payment.id}});assert.equal(internalRejectedRefund.rejectedById,approver.id);assert.equal(internalRejectedRefund.rejectionReason,'不符合退款条件');assert.equal(internalRejectedRefund.approvedById,null);
      assert.equal(await db.coinTransaction.count({where:{refundReleaseId:internalRejectedRefund.id}}),1);
      const approvalView=await (await refundOrders(webRequest(`/api/admin/finance/orders?orderNo=${internallyRejected.payment.orderNo}`,{token:approverToken}))).json();assert.equal(approvalView[0].refund.requestedByMe,false);assert.equal(Object.hasOwn(approvalView[0].refund,'actorId'),false);assert.equal(Object.hasOwn(approvalView[0].refund,'rejectedById'),false);
      const requesterView=await (await refundOrders(webRequest(`/api/admin/finance/orders?orderNo=${internallyRejected.payment.orderNo}`,{token:internallyRejected.jwt}))).json();assert.equal(requesterView[0].refund.requestedByMe,true);

      const rejected = await makePaidOrder('reject', 500);
      process.env.PAYMENT_ADMIN_USER_IDS = rejected.owner.id;
      refundOutcome = 'reject';
      const rejectRequest = await refund(webRequest(`/api/admin/finance/orders/${rejected.payment.orderNo}/refund`, { method: 'POST', token: rejected.jwt, body: { action: 'request', reason: 'customer request' } }), { params: { orderNo: rejected.payment.orderNo } });
      assert.equal(rejectRequest.status,201);assert.equal((await rejectRequest.json()).status,'PENDING_APPROVAL');
      const selfApproval=await refund(webRequest(`/api/admin/finance/orders/${rejected.payment.orderNo}/refund`,{method:'POST',token:rejected.jwt,body:{action:'approve',reason:'self approve'}}),{params:{orderNo:rejected.payment.orderNo}});assert.equal(selfApproval.status,403);
      refundOutcome = 'reject';
      const rejectResult = await refund(webRequest(`/api/admin/finance/orders/${rejected.payment.orderNo}/refund`, { method: 'POST', token: approverToken, body: { action: 'approve', reason: '复核确认渠道退款' } }), { params: { orderNo: rejected.payment.orderNo } });
      assert.equal(rejectResult.status, 502);
      assert.equal((await db.paymentRefund.findUniqueOrThrow({ where: { paymentOrderId: rejected.payment.id } })).status, 'FAILED');
      assert.equal((await db.paymentOrder.findUniqueOrThrow({ where: { id: rejected.payment.id } })).status, 'PAID');
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: rejected.owner.id } })).coins, 500);
      const rejectedRefund = await db.paymentRefund.findUniqueOrThrow({ where: { paymentOrderId: rejected.payment.id } });
      assert.equal(rejectedRefund.actorId,rejected.owner.id);assert.equal(rejectedRefund.approvedById,approver.id);assert.equal(rejectedRefund.approvalReason,'复核确认渠道退款');
      assert.equal(await db.coinTransaction.count({ where: { refundId: rejectedRefund.id } }), 1);
      assert.equal(await db.coinTransaction.count({ where: { refundReleaseId: rejectedRefund.id } }), 1);

      const uncertain = await makePaidOrder('uncertain', 500);
      process.env.PAYMENT_ADMIN_USER_IDS = uncertain.owner.id;
      refundOutcome = 'network';
      const pendingUnknown = await refund(webRequest(`/api/admin/finance/orders/${uncertain.payment.orderNo}/refund`, { method: 'POST', token: uncertain.jwt, body: { action: 'request', reason: 'customer request' } }), { params: { orderNo: uncertain.payment.orderNo } });assert.equal(pendingUnknown.status,201);
      const unknownResult = await refund(webRequest(`/api/admin/finance/orders/${uncertain.payment.orderNo}/refund`, { method: 'POST', token: approverToken, body: { action: 'approve', reason: '复核确认退款' } }), { params: { orderNo: uncertain.payment.orderNo } });
      assert.equal(unknownResult.status, 502);
      const held = (await db.paymentRefund.findUniqueOrThrow({ where: { paymentOrderId: uncertain.payment.id } }));
      assert.equal(held.status, 'UNKNOWN');
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: uncertain.owner.id } })).coins, 375);
      const verified = await refund(webRequest(`/api/admin/finance/orders/${uncertain.payment.orderNo}/refund`, { method: 'POST', token: uncertain.jwt, body: { action: 'verify' } }), { params: { orderNo: uncertain.payment.orderNo } });
      assert.equal((await verified.json()).status, 'UNKNOWN');
      assert.equal(lastRefundParams.out_refund_no, held.refundNo);
      refundOutcome = 'success';
      const retried = await refund(webRequest(`/api/admin/finance/orders/${uncertain.payment.orderNo}/refund`, { method: 'POST', token: uncertain.jwt, body: { action: 'retry', reason: 'retry original refund' } }), { params: { orderNo: uncertain.payment.orderNo } });
      assert.equal(retried.status, 200, await retried.clone().text());
      assert.equal((await retried.json()).status, 'SUCCEEDED');
      assert.equal(lastRefundParams.out_refund_no, held.refundNo, 'retry must reuse the provider idempotency reference');
      assert.equal(lastRefundParams.money, '1.25');
      assert.equal((await db.paymentOrder.findUniqueOrThrow({ where: { id: uncertain.payment.id } })).status, 'REFUNDED');
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: uncertain.owner.id } })).coins, 375);
      const repeated = await refund(webRequest(`/api/admin/finance/orders/${uncertain.payment.orderNo}/refund`, { method: 'POST', token: uncertain.jwt, body: { action: 'retry' } }), { params: { orderNo: uncertain.payment.orderNo } });
      assert.equal((await repeated.json()).status, 'SUCCEEDED');
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: uncertain.owner.id } })).coins, 375);
      assert.equal(await db.coinTransaction.count({ where: { refundId: held.id } }), 1);
      const { GET: financeReport } = await import('../src/app/api/admin/finance/report/route.ts');
      process.env.PAYMENT_ADMIN_USER_IDS = uncertain.owner.id;
      const finalReport = await (await financeReport(webRequest('/api/admin/finance/report?days=7', { token: uncertain.jwt }))).json();
      assert.equal(finalReport.completedRefunds, 1);
      assert.equal(finalReport.refundedAmountCnyCents, 125);
      assert.equal(finalReport.netAfterRefundsCnyCents, 500);
      assert.equal(finalReport.refundAnomalies.length, 0);
      const confirmed = await makePaidOrder('confirmed', 500);
      process.env.PAYMENT_ADMIN_USER_IDS = confirmed.owner.id;
      refundOutcome = 'network';
      const confirmationRequest = await refund(webRequest(`/api/admin/finance/orders/${confirmed.payment.orderNo}/refund`, { method: 'POST', token: confirmed.jwt, body: { action: 'request', reason: 'provider completed but response was lost' } }), { params: { orderNo: confirmed.payment.orderNo } });assert.equal(confirmationRequest.status,201);
      const confirmationUnknown = await refund(webRequest(`/api/admin/finance/orders/${confirmed.payment.orderNo}/refund`, { method: 'POST', token: approverToken, body: { action: 'approve', reason: '复核确认退款' } }), { params: { orderNo: confirmed.payment.orderNo } });
      assert.equal(confirmationUnknown.status, 502);
      queryStatus = 2;
      const confirmation = await refund(webRequest(`/api/admin/finance/orders/${confirmed.payment.orderNo}/refund`, { method: 'POST', token: confirmed.jwt, body: { action: 'verify' } }), { params: { orderNo: confirmed.payment.orderNo } });
      assert.equal((await confirmation.json()).status, 'SUCCEEDED');
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: confirmed.owner.id } })).coins, 375);
      const confirmedReport = await (await financeReport(webRequest('/api/admin/finance/report?days=7', { token: confirmed.jwt }))).json();
      assert.equal(confirmedReport.completedRefunds, 2);
      assert.equal(confirmedReport.refundedAmountCnyCents, 250);
      assert.equal(confirmedReport.netAfterRefundsCnyCents, 500);
      assert.equal(confirmedReport.refundAnomalies.length, 0);
      assert.equal(confirmedReport.validationMetrics.refundedCohortOrders, 2);
      assert.equal(confirmedReport.validationMetrics.paidOrderCount, 6);
      assert.equal(confirmedReport.validationMetrics.paidOrderRefundRate, 2/6);
      const concurrent=await makePaidOrder('concurrentapproval',500);process.env.PAYMENT_ADMIN_USER_IDS=concurrent.owner.id;
      const concurrentRequest=await refund(webRequest(`/api/admin/finance/orders/${concurrent.payment.orderNo}/refund`,{method:'POST',token:concurrent.jwt,body:{action:'request',reason:'并发审批验收'}}),{params:{orderNo:concurrent.payment.orderNo}});assert.equal(concurrentRequest.status,201);
      refundOutcome='success';
      const providerCallsBeforeApproval=providerRequestCount;
      const approvals=await Promise.all(Array.from({length:2},()=>refund(webRequest(`/api/admin/finance/orders/${concurrent.payment.orderNo}/refund`,{method:'POST',token:approverToken,body:{action:'approve',reason:'并发批准验收'}}),{params:{orderNo:concurrent.payment.orderNo}})));
      assert.equal(approvals.filter(response=>response.status===200).length,1);assert.equal(approvals.filter(response=>response.status===409).length,1);assert.equal(providerRequestCount,providerCallsBeforeApproval+1);
    });
    await t.test('package administration, scheduled bonus, stale quotes and existing order snapshots', async () => {
      const { GET: catalog, POST: add } = await import('../src/app/api/admin/finance/packages/route.ts');
      const { PUT: edit } = await import('../src/app/api/admin/finance/packages/[id]/route.ts');
      const { effectivePackageBonus } = await import('../src/lib/coins/package-service.ts');
      process.env.PAYMENT_ADMIN_USER_IDS = user.id;
      const fields = { label: '管理测试套餐', coins: 60, bonus: 0, priceCnyCents: 600, sortOrder: 0, isActive: true, bonusStartsAt: null, bonusEndsAt: null };
      assert.equal((await catalog(webRequest('/api/admin/finance/packages'))).status, 401);
      process.env.PAYMENT_ADMIN_USER_IDS = 'nobody';
      assert.equal((await add(webRequest('/api/admin/finance/packages', { method: 'POST', token, body: fields }))).status, 403);
      process.env.PAYMENT_ADMIN_USER_IDS = user.id;
      const auditCount = await db.coinPackageChange.count();
      for (const patch of [{ priceCnyCents: 0 }, { coins: -1 }, { bonusStartsAt: '2026-02-30T00:00:00Z', bonusEndsAt: '2026-03-10T00:00:00Z', bonus: 10 }, { bonusStartsAt: new Date().toISOString(), bonusEndsAt: null }]) {
        assert.equal((await add(webRequest('/api/admin/finance/packages', { method: 'POST', token, body: { ...fields, ...patch } }))).status, 400);
      }
      assert.equal(await db.coinPackageChange.count(), auditCount);
      const added = await add(webRequest('/api/admin/finance/packages', { method: 'POST', token, body: fields }));
      assert.equal(added.status, 201);
      const managed = await added.json();
      assert.equal(await db.coinPackageChange.count(), auditCount + 1);
      const start = new Date(Date.now() - 60000), end = new Date(Date.now() + 60000);
      const promotion = { ...fields, version: 0, bonus: 6, bonusStartsAt: start.toISOString(), bonusEndsAt: end.toISOString() };
      const edited = await edit(webRequest(`/api/admin/finance/packages/${managed.id}`, { method: 'PUT', token, body: promotion }), { params: { id: managed.id } });
      assert.equal(edited.status, 200);
      assert.equal((await edited.json()).version, 1);
      const bonus = { bonus: 6, bonusStartsAt: start, bonusEndsAt: end };
      assert.equal(effectivePackageBonus(bonus, new Date(start.getTime() - 1)), 0);
      assert.equal(effectivePackageBonus(bonus, start), 6);
      assert.equal(effectivePackageBonus(bonus, end), 0);
      assert.equal((await edit(webRequest(`/api/admin/finance/packages/${managed.id}`, { method: 'PUT', token, body: promotion }), { params: { id: managed.id } })).status, 409);
      assert.equal(await db.coinPackageChange.count(), auditCount + 2, 'rejected update must not append audit');
      const publicData = await (await getPackages()).json();
      assert.equal(publicData.find(row => row.id === managed.id).bonus, 6);
      const requests = providerRequestCount;
      const stale = await createOrder(webRequest('/api/coins/orders', { method: 'POST', token, body: { packageId: managed.id, idempotencyKey: randomUUID(), quote: { amountCnyCents: 600, coinAmount: 60 } } }));
      assert.equal(stale.status, 409);
      assert.equal((await stale.json()).code, 'PACKAGE_CHANGED');
      assert.equal(providerRequestCount, requests);
      const campaignOrderKey = randomUUID();
      const purchased = await createOrder(webRequest('/api/coins/orders', { method: 'POST', token, body: { packageId: managed.id, idempotencyKey: campaignOrderKey, quote: { amountCnyCents: 600, coinAmount: 66 } } }));
      assert.equal(purchased.status, 200);
      const campaignOrder = await purchased.json();
      const deactivate = await edit(webRequest(`/api/admin/finance/packages/${managed.id}`, { method: 'PUT', token, body: { ...fields, version: 1, coins: 100, priceCnyCents: 1000, isActive: false } }), { params: { id: managed.id } });
      assert.equal(deactivate.status, 200);
      assert(!(await (await getPackages()).json()).some(row => row.id === managed.id));
      const retriedOrder = await createOrder(webRequest('/api/coins/orders', { method: 'POST', token, body: { packageId: managed.id, idempotencyKey: campaignOrderKey } }));
      assert.equal(retriedOrder.status, 200);
      assert.equal((await retriedOrder.json()).orderNo, campaignOrder.orderNo);
      const stored = await db.paymentOrder.findUniqueOrThrow({ where: { orderNo: campaignOrder.orderNo } });
      assert.equal(stored.amountCnyCents, 600);
      assert.equal(stored.coinAmount, 66);
      assert.equal(stored.packageBonus, 6);
      const history = await (await catalog(webRequest('/api/admin/finance/packages', { token }))).json();
      assert.equal(history.changes[0].actorId, user.id);
      assert.equal(JSON.parse(history.changes[0].beforeJson).version, 1);
      assert.equal(JSON.parse(history.changes[0].afterJson).isActive, false);
      const { initializeDefaultPackages } = await import('../src/lib/coins/default-packages.ts');
      await initializeDefaultPackages(db);
      assert.equal((await db.coinPackage.findUniqueOrThrow({ where: { id: 'xingban-cny-60' } })).priceCnyCents, 600);
      await db.coinPackage.update({ where: { id: 'xingban-cny-60' }, data: { bonus: 3 } });
      await initializeDefaultPackages(db);
      assert.equal((await db.coinPackage.findUniqueOrThrow({ where: { id: 'xingban-cny-60' } })).bonus, 3, 'seed preserves admin changes');
    });
    t.diagnostic('Local synthetic RSA keys and a local mock provider were used; no real AI call or payment was made.');
    await t.test('equivalent provider amount spellings settle once and invalid or tampered amounts never credit', async()=>{
      const amountOrder=await db.paymentOrder.create({data:{orderNo:`DECIMAL-${now}`,idempotencyKey:randomUUID(),userId:user.id,packageCoins:10,packageBonus:0,coinAmount:10,amountCnyCents:100}});
      const fields={pid:'9101001',trade_no:`DECIMAL-PROVIDER-${now}`,out_trade_no:amountOrder.orderNo,trade_status:'TRADE_SUCCESS',timestamp:String(Math.floor(Date.now()/1000)),money:'1'};
      const coinsBefore=(await db.user.findUniqueOrThrow({where:{id:user.id}})).coins;
      for(const money of ['1.001','1e0','0.99'])assert.equal((await notify(new Request(notificationUrl({...fields,money})))).status,400);
      const changedEncoding=notificationUrl(fields).replace('money=1&','money=1.00&');
      assert.notEqual(changedEncoding,notificationUrl(fields));
      assert.equal((await notify(new Request(changedEncoding))).status,400,'verify raw signed input before comparing cents');
      assert.equal((await db.user.findUniqueOrThrow({where:{id:user.id}})).coins,coinsBefore);
      for(const money of ['1','1.0','1.00'])assert.equal((await notify(new Request(notificationUrl({...fields,money})))).status,200);
      assert.equal((await db.user.findUniqueOrThrow({where:{id:user.id}})).coins,coinsBefore+10);
      assert.equal(await db.coinTransaction.count({where:{paymentOrderId:amountOrder.id}}),1);
      assert.equal((await db.paymentOrder.findUniqueOrThrow({where:{id:amountOrder.id}})).status,'PAID');
    });
  } finally {
    await db.$disconnect();
    await new Promise((resolve) => provider.close(resolve));
  }
});
