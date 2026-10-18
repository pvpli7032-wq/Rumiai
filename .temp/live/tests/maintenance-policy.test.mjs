import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {NextRequest} from 'next/server';

const file=`maintenance-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL=`file:./${file}`;process.env.JWT_SECRET=randomBytes(48).toString('hex');process.env.MODERATOR_USER_IDS='';process.env.PAYMENT_ADMIN_USER_IDS='';
writeFileSync(path.resolve('prisma',file),'',{flag:'wx'});
const env={...process.env};delete env.RUST_LOG;const migration=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});assert.equal(migration.status,0,migration.stdout+migration.stderr);
const {db,pragmasReady}=await import('../src/lib/db.ts');await pragmasReady;
const {bootstrapOwner,saveOperator}=await import('../src/lib/admin/management-service.ts');
const {readMaintenancePolicy,saveMaintenancePolicy,readPublicMaintenance}=await import('../src/lib/operations/maintenance-service.ts');
const {middleware}=await import('../src/middleware.ts');
const {GET:statusRoute}=await import('../src/app/api/operations/status/route.ts');
const {GET:settingsRoute,PATCH:saveRoute}=await import('../src/app/api/admin/operations/maintenance/route.ts');
const {signToken}=await import('../src/lib/auth.ts');
test.after(async()=>{await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])rmSync(path.resolve('prisma',file+suffix),{force:true});});

test('maintenance policy is permissioned, versioned and blocks new business writes while preserving recovery channels',async()=>{
  const users=[];for(const name of ['owner','manager','viewer','ordinary'])users.push(await db.user.create({data:{username:`maintenance_${name}`,email:`maintenance-${name}@example.invalid`,passwordHash:'synthetic-only'}}));const [owner,manager,viewer,ordinary]=users;await bootstrapOwner(owner.email);
  for(const [user,code] of [[manager,'OPERATIONS_MANAGER'],[viewer,'OPERATIONS_VIEWER']]){const role=await db.adminRole.findUniqueOrThrow({where:{code}});await saveOperator(owner.id,{userId:user.id,enabled:true,roleIds:[role.id],version:0,reason:'隔离维护权限测试'});}
  const payload={enabled:true,message:'隔离维护，请稍后提交。',retryAfterSeconds:120,version:0,reason:'本地维护演练'};
  assert.equal((await readPublicMaintenance()).enabled,false);
  assert.equal((await middleware(new NextRequest('http://local.test/api/checkin',{method:'POST'}))).headers.get('x-middleware-next'),'1');
  await assert.rejects(()=>readMaintenancePolicy(ordinary.id),error=>error.status===403);
  for(const user of [ordinary,viewer])await assert.rejects(()=>saveMaintenancePolicy(user.id,payload),error=>error.status===403);
  for(const values of [{retryAfterSeconds:0},{version:-1},{message:''},{reason:''},{enabled:'true'}])await assert.rejects(()=>saveMaintenancePolicy(manager.id,{...payload,...values}),error=>error.status===400);
  const saved=await saveMaintenancePolicy(manager.id,payload);assert.equal(saved.version,1);
  await assert.rejects(()=>saveMaintenancePolicy(manager.id,payload),error=>error.status===409);
  const publicResponse=await statusRoute();assert.equal(publicResponse.status,200);assert.deepEqual(await publicResponse.json(),{enabled:true,message:payload.message,retryAfterSeconds:120});
  const protectedWrites=[
    ['POST','/api/auth/register'],['POST','/api/checkin'],['POST','/api/coins/purchase'],['POST','/api/upload'],
    ['POST','/api/conversations/c1/messages'],['POST','/api/conversations/c1/messages/m1/regenerate'],
    ['PATCH','/api/users/me'],['DELETE','/api/posts/p1'],['PUT','/api/characters/c1'],['POST','/api/posts/p1.json'],
    ['POST','/api/administer'],['POST','/api/characters/management-extra'],['POST','/api/auth/login/extra'],
    ['POST','/api/coins/payments/ezfp/notify/extra'],
  ];
  for(const [method,pathname] of protectedWrites){const response=await middleware(new NextRequest(`http://local.test${pathname}`,{method}));assert.equal(response.status,503,pathname);assert.equal(response.headers.get('retry-after'),'120');assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{error:payload.message,code:'MAINTENANCE_MODE'});}
  for(const [method,pathname] of [
    ['GET','/api/conversations'],['HEAD','/api/site'],['OPTIONS','/api/checkin'],['GET','/discover'],
    ['POST','/api/auth/login'],['POST','/api/auth/logout'],['GET','/api/coins/payments/ezfp/notify'],
    ['PATCH','/api/admin/operations/maintenance'],['PUT','/api/characters/management/c1/models'],
    ['POST','/api/finance/orders/order1/refund'],['PATCH','/api/moderation/reports/r1'],
    ['POST','/api/accounts/management/u1'],['PATCH','/api/circles/management/c1'],
  ])assert.equal((await middleware(new NextRequest(`http://local.test${pathname}`,{method}))).headers.get('x-middleware-next'),'1',pathname);
  const viewerToken=await signToken({userId:viewer.id,email:viewer.email});
  assert.equal((await settingsRoute(new Request('http://local.test/api/admin/operations/maintenance'))).status,401);
  const readResponse=await settingsRoute(new Request('http://local.test/api/admin/operations/maintenance',{headers:{Authorization:`Bearer ${viewerToken}`}}));assert.equal(readResponse.status,200);
  const denied=await saveRoute(new Request('http://local.test/api/admin/operations/maintenance',{method:'PATCH',headers:{Authorization:`Bearer ${viewerToken}`,'Content-Type':'application/json'},body:JSON.stringify({...payload,version:1})}));assert.equal(denied.status,403);
  assert.equal(await db.adminAuditLog.count({where:{action:'UPDATE_MAINTENANCE_POLICY'}}),1);
  assert.equal((await db.user.findUniqueOrThrow({where:{id:ordinary.id}})).coins,100);assert.equal(await db.aiCall.count(),0);
  assert.equal((await saveMaintenancePolicy(manager.id,{...payload,enabled:false,version:1,reason:'维护结束'})).version,2);
  assert.equal((await middleware(new NextRequest('http://local.test/api/checkin',{method:'POST'}))).headers.get('x-middleware-next'),'1');
});
