import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file=`payment-order-list-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL=`file:./${file}`;
process.env.JWT_SECRET=randomUUID()+randomUUID();
process.env.MODERATOR_USER_IDS='';
process.env.PAYMENT_ADMIN_USER_IDS='';
const env={...process.env};delete env.RUST_LOG;
const migrated=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});
assert.equal(migrated.status,0,migrated.stdout+migrated.stderr);

const {db}=await import('../src/lib/db.ts');
const {signToken}=await import('../src/lib/auth.ts');
const {listPaymentOrders}=await import('../src/lib/payments/order-management-service.ts');
const {GET}=await import('../src/app/api/admin/finance/orders/all/route.ts');
const {GET:exportRoute}=await import('../src/app/api/admin/finance/orders/export/route.ts');
const staff=await db.user.create({data:{username:'order_finance',email:'order-finance@example.invalid',passwordHash:'synthetic'}});
const ordinary=await db.user.create({data:{username:'order_reader',email:'order-reader@example.invalid',passwordHash:'synthetic'}});
  const exportOwner=await db.user.create({data:{username:'order_export_owner',email:'order-export-owner@example.invalid',passwordHash:'synthetic'}});
  await db.paymentOrder.create({data:{orderNo:'EXPORT-001',idempotencyKey:randomUUID(),userId:exportOwner.id,packageCoins:10,packageBonus:0,coinAmount:10,amountCnyCents:100,currency:'CNY',providerTradeNo:'=FORMULA',providerPayInfo:'https://pay.invalid/private'}});
process.env.PAYMENT_ADMIN_USER_IDS=staff.id;
const makeToken=user=>signToken({userId:user.id,email:user.email,tokenVersion:user.tokenVersion});
const request=async(user,path)=>new Request('http://localhost'+path,{headers:user?{Authorization:'Bearer '+await makeToken(user)}:{}});
test.after(async()=>{await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])rmSync(path.resolve('prisma',file+suffix),{force:true});});

test('finance order management filters, paginates and exposes only the operations projection',async()=>{
  const orders=[];
  for(let index=0;index<31;index++){
    const owner=await db.user.create({data:{username:'order_owner_'+index,email:'order-owner-'+index+'@example.invalid',passwordHash:'synthetic'}});
    const order=await db.paymentOrder.create({data:{
      orderNo:'ORDER-'+String(index).padStart(3,'0'),
      idempotencyKey:randomUUID(),userId:owner.id,packageCoins:100,packageBonus:index,
      coinAmount:100+index,amountCnyCents:600,currency:'CNY',
      status:index%2?'PAID':'PENDING',providerTradeNo:'CHANNEL-'+index,
      providerPayInfo:'https://pay.invalid/secret-link',
      ...(index%2?{paidAt:new Date()}:{}),
    }});
    orders.push(order);
    if(index===7)await db.paymentCallbackEvent.create({data:{paymentOrderId:order.id,provider:'EZFP',providerTradeNo:'CHANNEL-7',outcome:'SETTLED'}});
  }
  const page=await listPaymentOrders({page:1,pageSize:25,status:'ALL'});
  assert.equal(page.total,32);assert.equal(page.items.length,25);assert.equal(page.items[0].orderNo,'ORDER-030');assert.equal(page.page,1);
  assert.equal(Object.hasOwn(page.items[0],'userId'),false);assert.equal(Object.hasOwn(page.items[0],'providerPayInfo'),false);
  const paid=await listPaymentOrders({page:1,pageSize:10,status:'PAID'});assert.equal(paid.total,15);assert(paid.items.every(row=>row.status==='PAID'));
  const search=await listPaymentOrders({page:1,pageSize:10,status:'ALL',query:'CHANNEL-7'});assert.equal(search.total,1);assert.equal(search.items[0].orderNo,'ORDER-007');
  assert.equal(search.items[0].callbackEvents.length,1);assert.equal(search.items[0].callbackEvents[0].outcome,'SETTLED');
  await assert.rejects(()=>listPaymentOrders({status:'UNKNOWN'}),error=>error.status===400);
  const anonymous=await GET(await request(null,'/api/admin/finance/orders/all'));assert.equal(anonymous.status,401);
  const forbidden=await GET(await request(ordinary,'/api/admin/finance/orders/all'));assert.equal(forbidden.status,403);
  const response=await GET(await request(staff,'/api/admin/finance/orders/all?page=2&pageSize=10&status=PAID'));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);
  const body=await response.json();assert.equal(body.total,15);assert.equal(body.items.length,5);assert.equal(JSON.stringify(body).includes('pay.invalid'),false);assert.equal(JSON.stringify(body).includes(staff.id),false);
  const exportDenied=await exportRoute(await request(null,'/api/admin/finance/orders/export'));assert.equal(exportDenied.status,401);
  const exported=await exportRoute(await request(staff,'/api/admin/finance/orders/export?status=ALL'));
  assert.equal(exported.status,200);assert.match(exported.headers.get('content-type'),/text\/csv/);assert.match(exported.headers.get('content-disposition'),/attachment/);
  const exportedBytes=new Uint8Array(await exported.arrayBuffer());assert.deepEqual([...exportedBytes.slice(0,3)],[0xef,0xbb,0xbf]);
  const csv=new TextDecoder().decode(exportedBytes);assert(csv.startsWith('"订单号"'));assert(csv.includes("'=FORMULA"));assert.equal(csv.includes('pay.invalid'),false);assert.equal(csv.includes(exportOwner.id),false);
  assert.equal((await exportRoute(await request(staff,'/api/admin/finance/orders/export?status=INVALID'))).status,400);
});

