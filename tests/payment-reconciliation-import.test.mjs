import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file=`payment-reconciliation-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL=`file:./${file}`;process.env.JWT_SECRET=randomUUID()+randomUUID();process.env.PAYMENT_ADMIN_USER_IDS='';process.env.MODERATOR_USER_IDS='';
const env={...process.env};delete env.RUST_LOG;
const migration=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});
assert.equal(migration.status,0,migration.stdout+migration.stderr);
const {db}=await import('../src/lib/db.ts');
const {signToken}=await import('../src/lib/auth.ts');
const {bootstrapOwner}=await import('../src/lib/admin/management-service.ts');
const {GET:readBatches,POST:importRoute}=await import('../src/app/api/admin/finance/reconciliation/route.ts');
const {GET:readBatch}=await import('../src/app/api/admin/finance/reconciliation/[id]/route.ts');
const owner=await db.user.create({data:{username:`recon_owner_${process.pid}`,email:`recon-owner-${process.pid}@example.invalid`,passwordHash:'synthetic'}});
const ordinary=await db.user.create({data:{username:`recon_user_${process.pid}`,email:`recon-user-${process.pid}@example.invalid`,passwordHash:'synthetic'}});
await bootstrapOwner(owner.email);
const makeToken=user=>signToken({userId:user.id,email:user.email,tokenVersion:user.tokenVersion});
const request=async(user,url,method='GET',body)=>new Request('http://localhost'+url,{method,headers:{...(user?{Authorization:'Bearer '+await makeToken(user)}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
const orderNo=()=>`KH${Date.now().toString(36).toUpperCase()}${randomUUID().replaceAll('-','').slice(0,16).toUpperCase()}`;
test.after(async()=>{await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])rmSync(path.resolve('prisma',file+suffix),{force:true});});

test('statement CSV imports immutable normalized rows, reconciles order totals, and never changes orders or balances',async()=>{
  const buyer=await db.user.create({data:{username:`recon_buyer_${process.pid}`,email:`recon-buyer-${process.pid}@example.invalid`,passwordHash:'synthetic',coins:456}});
  const matched=await db.paymentOrder.create({data:{orderNo:orderNo(),idempotencyKey:randomUUID(),userId:buyer.id,packageCoins:1234,packageBonus:0,coinAmount:1234,amountCnyCents:1234,providerTradeNo:'EZFP-'+randomUUID().replaceAll('-',''),status:'PAID',paidAt:new Date()}});
  const wrongAmount=await db.paymentOrder.create({data:{orderNo:orderNo(),idempotencyKey:randomUUID(),userId:buyer.id,packageCoins:500,packageBonus:0,coinAmount:500,amountCnyCents:500,providerTradeNo:'EZFP-'+randomUUID().replaceAll('-',''),status:'PAID',paidAt:new Date()}});
  const missing=await db.paymentOrder.create({data:{orderNo:orderNo(),idempotencyKey:randomUUID(),userId:buyer.id,packageCoins:700,packageBonus:0,coinAmount:700,amountCnyCents:700,providerTradeNo:'EZFP-'+randomUUID().replaceAll('-',''),status:'PAID',paidAt:new Date()}});
  const unknownTrade='EZFP-'+randomUUID().replaceAll('-',''),unknownOrder=orderNo(),periodStart=new Date(Date.now()-3600000).toISOString(),periodEnd=new Date(Date.now()+3600000).toISOString(),paidAt=new Date().toISOString();
  const csv=[
    'trade_no,out_trade_no,money,fee,paid_at,status',
    `${matched.providerTradeNo},${matched.orderNo},12.34,0.37,${paidAt},TRADE_SUCCESS`,
    `${wrongAmount.providerTradeNo},${wrongAmount.orderNo},6.00,0.20,${paidAt},1`,
    `${unknownTrade},${unknownOrder},3.00,0.10,${paidAt},PAID`,
  ].join('\r\n');
  assert.equal((await importRoute(await request(null,'/api/admin/finance/reconciliation','POST',{csv,reason:'未授权导入'}))).status,401);
  assert.equal((await importRoute(await request(ordinary,'/api/admin/finance/reconciliation','POST',{csv,reason:'普通用户导入'}))).status,403);
  const balanceBefore=(await db.user.findUniqueOrThrow({where:{id:buyer.id}})).coins;
  const first=await importRoute(await request(owner,'/api/admin/finance/reconciliation','POST',{csv,reason:'EZFP 测试账单',periodStart,periodEnd}));
  assert.equal(first.status,201);const batch=await first.json();assert.equal(batch.rowCount,4);assert.equal(batch.matchedRowCount,1);assert.equal(batch.exceptionRowCount,3);assert.equal(batch.grossCnyCents,2134);assert.equal(batch.feeCnyCents,67);assert.equal(batch.netCnyCents,2067);
  const detail=await readBatch(await request(owner,`/api/admin/finance/reconciliation/${batch.id}?page=1&pageSize=25`),{params:Promise.resolve({id:batch.id})});
  assert.equal(detail.status,200);const payload=await detail.json();assert.deepEqual(payload.entries.map(row=>row.matchStatus),['MATCHED','AMOUNT_MISMATCH','ORDER_NOT_FOUND','MISSING_IN_STATEMENT']);assert.equal(payload.entries[0].internalAmountCnyCents,1234);assert.equal(payload.entries[1].exceptionCode,'amount_mismatch');assert.equal(payload.entries[3].paymentOrderId,undefined);assert.equal(payload.entries[3].internalAmountCnyCents,700);
  assert.equal((await db.paymentOrder.findUniqueOrThrow({where:{id:matched.id}})).status,'PAID');assert.equal((await db.user.findUniqueOrThrow({where:{id:buyer.id}})).coins,balanceBefore);
  const duplicate=await importRoute(await request(owner,'/api/admin/finance/reconciliation','POST',{csv,reason:'同一账单重复提交',periodStart,periodEnd}));assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).id,batch.id);assert.equal((await db.paymentReconciliationBatch.count()),1);
  const listed=await readBatches(await request(owner,'/api/admin/finance/reconciliation'));assert.equal((await listed.json()).batches.length,1);
  const malformed=await importRoute(await request(owner,'/api/admin/finance/reconciliation','POST',{csv:csv.replace('0.37','-0.37'),reason:'无效费用',periodStart,periodEnd}));assert.equal(malformed.status,400);
  assert.equal((await db.paymentReconciliationEntry.count({where:{batchId:batch.id}})),4);
});
