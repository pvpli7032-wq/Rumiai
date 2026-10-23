import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, type Server} from 'node:http';
import {generateKeyPairSync} from 'node:crypto';

const enabled = Boolean(process.env.MEMBERSHIP_INTEGRATION_DB);
const it = enabled ? test : test.skip;
let db: import('@prisma/client').PrismaClient;
let workflow: typeof import('@rumiai/backend/workflows/membership-purchase');
let sign: typeof import('@rumiai/backend/modules/payments/ezfp-v2').signEzfpParams;
let privateKey = '';
let server: Server;
let port = 0;
let refundMode: 'success'|'uncertain'|'rejected' = 'success';
const refundRequests: Array<Record<string, string>> = [];
const checkoutRequests: Array<Record<string, string>> = [];

function signedQuery(fields: Record<string,string>): Record<string,string> {
  const params: Record<string,string> = {...fields, timestamp:String(Math.floor(Date.now()/1000)), sign_type:'RSA'};
  params.sign = sign(params, privateKey);
  return params;
}
function signedPayload(fields: Record<string, string|number>): Record<string,string|number> {
  const params = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value)]));
  params.timestamp = String(Math.floor(Date.now() / 1000));
  params.sign_type = 'RSA';
  params.sign = sign(params, privateKey);
  return typeof fields.code === 'number' ? {...params, code: fields.code} : params;
}

before(async () => {
  if (!enabled) return;
  const databasePath = process.env.MEMBERSHIP_INTEGRATION_DB!;
  process.env.DATABASE_URL = databasePath.startsWith('file:') ? databasePath : `file:${databasePath}`;
  (process.env as Record<string,string>).NODE_ENV = 'test';
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  process.env.EZFP_ENABLED = 'true';
  process.env.EZFP_PID = '10001';
  process.env.EZFP_REFUNDS_ENABLED = 'true';
  const pair = generateKeyPairSync('rsa', {modulusLength: 2048});
  privateKey = pair.privateKey.export({type: 'pkcs1', format: 'pem'}).toString();
  process.env.EZFP_MERCHANT_PRIVATE_KEY = privateKey;
  process.env.EZFP_PLATFORM_PUBLIC_KEY = pair.publicKey.export({type: 'pkcs1', format: 'pem'}).toString();
  server = createServer(async (request, response) => {
    const body = await new Promise<string>(resolve => {let value=''; request.on('data', chunk => {value += chunk;}); request.on('end', () => resolve(value));});
    const input = Object.fromEntries(new URLSearchParams(body));
    if (request.url?.endsWith('/refund')) refundRequests.push(input);
    if (request.url?.endsWith('/create')) checkoutRequests.push(input);
    response.setHeader('content-type', 'application/json');
    if (request.url?.endsWith('/create')) response.end(JSON.stringify(signedPayload({code: 0, trade_no: `TRADE-${input.out_trade_no}`, pay_type: 'jump', pay_info: 'http://localhost:3012/ezfp-test'})));
    else if (request.url?.endsWith('/refund') && refundMode === 'uncertain') response.end('{"code":0}');
    else if (request.url?.endsWith('/refund') && refundMode === 'rejected') response.end(JSON.stringify(signedPayload({code:1})));
    else response.end(JSON.stringify(signedPayload({code: 0, trade_no: input.trade_no, out_refund_no: input.out_refund_no, money: input.money, refund_no: `PROVIDER-${input.out_refund_no}`})));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => {port = (server.address() as {port:number}).port; resolve();}));
  process.env.EZFP_API_BASE_URL = `http://127.0.0.1:${port}`;
  const prisma = await import('@prisma/client');
  db = new prisma.PrismaClient();
  await db.$connect();
  await db.paymentCheckoutPolicy.upsert({where:{id:'primary'},create:{id:'primary',enabled:true},update:{enabled:true}});
  ({signEzfpParams: sign} = await import('@rumiai/backend/modules/payments/ezfp-v2'));
  workflow = await import('@rumiai/backend/workflows/membership-purchase');
});

after(async () => {if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (db) await db.$disconnect();});

async function fixture() {
  const suffix = `${Date.now()}${Math.random().toString(16).slice(2)}`.replace(/[^a-z0-9]/gi, '').slice(0, 20);
  const user = await db.user.create({data:{username:`mw${suffix}`,email:`mw${suffix}@example.test`,passwordHash:'integration-only'}});
  const plan = await db.membershipPlan.create({data:{code:`MW${suffix.toUpperCase()}`,name:'Workflow 月会员',durationDays:30,priceCents:3000,benefitsJson:JSON.stringify([{key:'DAILY_FREE_REPLIES',label:'每日免费回复',value:5}]),isActive:true}});
  return {user,plan};
}

it('checkout is server-priced, snapshot-stable, and isolated from coin idempotency keys', async () => {
  const f = await fixture();
  assert.equal(f.plan.isActive, true);
  assert.equal(f.plan.priceCents, 3000);
  await db.paymentOrder.create({data:{orderNo:`COIN${f.user.id}`,idempotencyKey:'same-key',userId:f.user.id,packageCoins:10,packageBonus:0,coinAmount:10,amountCnyCents:100}});
  const first = await workflow.createMembershipPayment({userId:f.user.id,planCode:f.plan.code,idempotencyKey:'same-key',paymentMethod:'alipay',clientIp:'127.0.0.1'});
  await db.membershipPlan.update({where:{id:f.plan.id},data:{priceCents:9000}});
  const replay = await workflow.createMembershipPayment({userId:f.user.id,planCode:f.plan.code,idempotencyKey:'same-key',paymentMethod:'alipay',clientIp:'127.0.0.1'});
  assert.equal(replay.amountCnyCents,3000);
  assert.equal(first.orderNo,replay.orderNo);
  assert.equal(await db.paymentOrder.count({where:{userId:f.user.id}}),2);
});

it('closed checkout gate blocks replay of a pending cached redirect without provider call', async () => {
  const f = await fixture();
  const first = await workflow.createMembershipPayment({userId:f.user.id,planCode:f.plan.code,idempotencyKey:`gate-${f.user.id}`,paymentMethod:'alipay',clientIp:'127.0.0.1'});
  assert.ok(first.redirectUrl);
  const providerCalls = checkoutRequests.length;
  await db.paymentCheckoutPolicy.update({where:{id:'primary'},data:{enabled:false}});
  try {
    await assert.rejects(
      () => workflow.createMembershipPayment({userId:f.user.id,planCode:f.plan.code,idempotencyKey:`gate-${f.user.id}`,paymentMethod:'alipay',clientIp:'127.0.0.1'}),
      error => error instanceof workflow.MembershipPaymentWorkflowError && error.code === 'PAYMENT_UNAVAILABLE' && error.status === 503,
    );
    const payment = await db.membershipOrder.findUniqueOrThrow({where:{orderNo:first.orderNo},include:{paymentOrder:true}});
    assert.equal(payment.status,'PENDING');
    assert.equal(payment.paymentOrder?.status,'PENDING');
    assert.equal(checkoutRequests.length, providerCalls, 'closed gate must not call EZFP for cached pending checkout');
  } finally {
    await db.paymentCheckoutPolicy.update({where:{id:'primary'},data:{enabled:true}});
  }
});

it('signed notify rejects PID/amount tampering and duplicate callback grants once', async () => {
  const f = await fixture();
  const created = await workflow.createMembershipPayment({userId:f.user.id,planCode:f.plan.code,idempotencyKey:`cb-${f.user.id}`,paymentMethod:'alipay',clientIp:'127.0.0.1'});
  const payment = await db.membershipOrder.findUniqueOrThrow({where:{orderNo:created.orderNo},include:{paymentOrder:true}});
  const base = {out_trade_no:payment.paymentOrder!.orderNo,trade_no:`TRADE-${payment.paymentOrder!.orderNo}`,money:'30.00',pid:'10001',trade_status:'TRADE_SUCCESS'};
  const bad = signedQuery({...base,pid:'99999'});
  await assert.rejects(() => workflow.settleMembershipEzfpNotification(`http://localhost/notify?${new URLSearchParams(bad)}`));
  await assert.rejects(() => workflow.settleMembershipEzfpNotification(`http://localhost/notify?${new URLSearchParams(signedQuery({...base,money:'29.00'}))}`));
  const good = signedQuery(base);
  const url = `http://localhost/notify?${new URLSearchParams(good)}`;
  assert.deepEqual(await workflow.settleMembershipEzfpNotification(url),{duplicate:false});
  assert.deepEqual(await workflow.settleMembershipEzfpNotification(url),{duplicate:true});
  assert.equal(await db.membershipGrant.count({where:{orderId:payment.id}}),1);
});

it('provider uncertainty leaves grant active; retry success revokes only that grant', async () => {
  const f = await fixture();
  const created = await workflow.createMembershipPayment({userId:f.user.id,planCode:f.plan.code,idempotencyKey:`rf-${f.user.id}`,paymentMethod:'alipay',clientIp:'127.0.0.1'});
  const payment = await db.membershipOrder.findUniqueOrThrow({where:{orderNo:created.orderNo},include:{paymentOrder:true}});
  const callback = signedQuery({out_trade_no:payment.paymentOrder!.orderNo,trade_no:`TRADE-${payment.paymentOrder!.orderNo}`,money:'30.00',pid:'10001',trade_status:'TRADE_SUCCESS'});
  await workflow.settleMembershipEzfpNotification(`http://localhost/notify?${new URLSearchParams(callback)}`);
  await db.membershipUsage.create({data:{orderId:payment.id,userId:f.user.id,benefitCode:'DAILY_FREE_REPLIES',idempotencyKey:`usage-${f.user.id}`} });
  refundMode='uncertain';
  await assert.rejects(() => workflow.refundMembershipPayment(f.user.id,created.orderNo));
  const uncertainRequest = refundRequests.at(-1)!;
  assert.equal((await db.membershipGrant.findUnique({where:{orderId:payment.id}}))?.status,'ACTIVE');
  refundMode='success';
  await workflow.refundMembershipPayment(f.user.id,created.orderNo);
  assert.equal(refundRequests.at(-1)!.out_refund_no, uncertainRequest.out_refund_no, 'unknown outcome must retry the same provider refund identifier');
  assert.equal(refundRequests.at(-1)!.money, uncertainRequest.money, 'unknown outcome must keep the same amount');
  assert.equal((await db.membershipGrant.findUnique({where:{orderId:payment.id}}))?.status,'REVOKED');
});

it('definitive rejection restores benefits and a retry recalculates actual usage',async()=>{
  const f=await fixture();
  const created=await workflow.createMembershipPayment({userId:f.user.id,planCode:f.plan.code,idempotencyKey:`reject-${f.user.id}`,clientIp:'127.0.0.1'});
  const order=await db.membershipOrder.findUniqueOrThrow({where:{orderNo:created.orderNo},include:{paymentOrder:true}});
  const callback=signedQuery({out_trade_no:order.paymentOrder!.orderNo,trade_no:`TRADE-${order.paymentOrder!.orderNo}`,money:'30.00',pid:'10001',trade_status:'TRADE_SUCCESS'});
  await workflow.settleMembershipEzfpNotification(`http://localhost/notify?${new URLSearchParams(callback)}`);
  refundMode='rejected';
  await assert.rejects(()=>workflow.refundMembershipPayment(f.user.id,created.orderNo),error=>error instanceof workflow.MembershipPaymentWorkflowError&&error.code==='PROVIDER_REJECTED');
  const rejectedRequest = refundRequests.at(-1)!;
  assert.equal((await db.membershipRefund.findUniqueOrThrow({where:{orderId:order.id}})).status,'FAILED');
  const membership=await import('@rumiai/backend/modules/memberships/service');
  assert.ok(await membership.readMembershipBenefit(f.user.id,'DAILY_FREE_REPLIES'),'definitive rejection must not freeze the membership');
  await membership.recordMembershipUsage({orderNo:order.orderNo,userId:f.user.id,benefitCode:'DAILY_FREE_REPLIES',idempotencyKey:`after-failure-${f.user.id}`});
  refundMode='success';
  const completed=await workflow.refundMembershipPayment(f.user.id,created.orderNo);
  assert.equal(completed.status,'COMPLETED');
  assert.equal(completed.amountCents,2900,'retry must not reuse the old unused full-refund quote');
  assert.notEqual(refundRequests.at(-1)!.out_refund_no, rejectedRequest.out_refund_no, 'a definitively rejected attempt cannot reuse its provider identifier for a changed amount');
  assert.equal((await db.membershipRefund.findUniqueOrThrow({where:{orderId:order.id}})).attempt,2);
  assert.equal((await db.paymentOrder.findUniqueOrThrow({where:{id:order.paymentOrderId!}})).status,'REFUNDED');
});
