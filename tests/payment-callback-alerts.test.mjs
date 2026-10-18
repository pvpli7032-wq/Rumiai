import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file=`callback-alerts-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL=`file:./${file}`;process.env.JWT_SECRET=randomUUID()+randomUUID();process.env.PAYMENT_ADMIN_USER_IDS='';process.env.MODERATOR_USER_IDS='';
const env={...process.env};delete env.RUST_LOG;
const migration=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});
assert.equal(migration.status,0,migration.stdout+migration.stderr);
const {db}=await import('../src/lib/db.ts');
const {signToken}=await import('../src/lib/auth.ts');
const {bootstrapOwner}=await import('../src/lib/admin/management-service.ts');
const {recordCallbackRejectionSample,readCallbackAlertSummary}=await import('../src/lib/payments/callback-alert-service.ts');
const {GET}=await import('../src/app/api/finance/callback-alerts/route.ts');
const owner=await db.user.create({data:{username:`callback_owner_${process.pid}`,email:`callback-owner-${process.pid}@example.invalid`,passwordHash:'synthetic'}});
const ordinary=await db.user.create({data:{username:`callback_user_${process.pid}`,email:`callback-user-${process.pid}@example.invalid`,passwordHash:'synthetic'}});
await bootstrapOwner(owner.email);
const token=user=>signToken({userId:user.id,email:user.email,tokenVersion:user.tokenVersion});
const request=async user=>new Request('http://localhost/api/finance/callback-alerts?hours=24',{headers:user?{Authorization:'Bearer '+await token(user)}:{}});
test.after(async()=>{await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])rmSync(path.resolve('prisma',file+suffix),{force:true});});

test('callback alert samples enforce a global reason/minute key and expose only low-cardinality data to finance readers',async()=>{
  const current=new Date(),now=new Date(Date.UTC(current.getUTCFullYear(),current.getUTCMonth(),current.getUTCDate(),current.getUTCHours(),10,0));
  const old=new Date(now.getTime()-31*24*60*60_000);
  await db.paymentCallbackAlertSample.create({data:{provider:'EZFP',minuteStart:old,reasonCode:'signature_or_timestamp',firstSeenAt:old,lastSeenAt:old}});
  assert.equal(await recordCallbackRejectionSample('signature_or_timestamp',now),true);
  assert.equal(await recordCallbackRejectionSample('signature_or_timestamp',new Date(now.getTime()+5_000)),false);
  assert.equal(await recordCallbackRejectionSample('untrusted reason text',new Date(now.getTime()+10_000)),true);
  assert.equal(await recordCallbackRejectionSample('signature_or_timestamp',new Date(now.getTime()+60_000)),true);
  const samples=await db.paymentCallbackAlertSample.findMany({where:{minuteStart:{gte:new Date(now.getTime()-60*60_000)}}});
  assert.equal(samples.length,3);assert.equal(new Set(samples.filter(row=>row.reasonCode==='signature_or_timestamp').map(row=>row.minuteStart.toISOString())).size,2);assert(samples.some(row=>row.reasonCode==='other'));
  assert.equal(await db.paymentCallbackAlertSample.count({where:{minuteStart:old}}),0,'old samples are pruned during the next accepted sample');

  assert.equal((await GET(await request(null))).status,401);assert.equal((await GET(await request(ordinary))).status,403);
  const response=await GET(await request(owner));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);
  const data=await response.json();assert.equal(data.sampledMinutes,3);assert.equal(data.retentionDays,30);assert.equal(data.reasons.find(row=>row.reasonCode==='signature_or_timestamp').sampledMinutes,2);
  const serialized=JSON.stringify(data);for(const sensitive of ['out_trade_no','trade_no','orderNo','providerTradeNo','clientIp','rawPayload'])assert.equal(serialized.includes(sensitive),false);
  assert.equal((await GET(new Request('http://localhost/api/finance/callback-alerts?hours=48',{headers:{Authorization:'Bearer '+await token(owner)}}))).status,400);
  await assert.rejects(()=>readCallbackAlertSummary(ordinary.id,24),error=>error.status===403);
});
