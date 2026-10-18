import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const file=`ai-cost-management-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL=`file:./${file}`;
process.env.JWT_SECRET=randomUUID()+randomUUID();
process.env.MODERATOR_USER_IDS='';
process.env.PAYMENT_ADMIN_USER_IDS='';
process.env.AI_DAILY_COST_BUDGETS='{"USD":{"site":900,"user":90}}';
process.env.AI_BUDGET_CIRCUIT_BREAKER='false';
process.env.AI_PRICE_MODEL='cost-fixture';
process.env.AI_MODEL='cost-fixture';
process.env.AI_INPUT_PRICE_PER_MILLION='1';
process.env.AI_OUTPUT_PRICE_PER_MILLION='2';
const env={...process.env};delete env.RUST_LOG;
const migrated=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});
assert.equal(migrated.status,0,migrated.stdout+migrated.stderr);

const {db}=await import('../src/lib/db.ts');
const {bootstrapOwner,saveOperator,saveRole}=await import('../src/lib/admin/management-service.ts');
const {readAiCostDashboard,saveAiCostCircuitBreaker,saveAiDailyCostBudget}=await import('../src/lib/ai/costs/budget-service.ts');
const {readAiDailyBudgetConfiguration}=await import('../src/lib/ai/costs/budget-config-service.ts');
const {readCostBudgetBlock}=await import('../src/lib/ai/budget-guard.ts');
const {signToken}=await import('../src/lib/auth.ts');
const {GET:readRoute,POST:writeRoute}=await import('../src/app/api/admin/ai/costs/route.ts');

const users=[];
for(const username of ['cost_owner','cost_manager','cost_reader','cost_user']){
  users.push(await db.user.create({data:{username,email:`${username}@example.invalid`,passwordHash:await bcrypt.hash(randomUUID(),4)}}));
}
const [owner,manager,reader,user]=users;
await bootstrapOwner(owner.email);
const managerRole=await db.adminRole.findUniqueOrThrow({where:{code:'AI_COST_MANAGER'}});
await saveOperator(owner.id,{userId:manager.id,enabled:true,version:0,roleIds:[managerRole.id],reason:'AI成本权限隔离测试'});
const readRole=await saveRole(owner.id,{name:'AI成本只读',permissions:['ai.costs.read'],reason:'AI成本只读权限'});
await saveOperator(owner.id,{userId:reader.id,enabled:true,version:0,roleIds:[readRole.id],reason:'AI成本只读权限'});
const tokenFor=async actor=>`Bearer ${await signToken({userId:actor.id,email:actor.email,tokenVersion:actor.tokenVersion})}`;
const denied=(fn,status)=>assert.rejects(fn,error=>error.status===status);
const makeRequest=async(actor,method='GET',body)=>new Request('http://localhost/api/admin/ai/costs',{method,headers:{Authorization:await tokenFor(actor),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});

test.after(async()=>{await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])rmSync(path.resolve('prisma',file+suffix),{force:true});});

test('AI cost budgets and breaker are permissioned, audited, versioned and authoritative for runtime admission',async()=>{
  const fixtureStartedAt=new Date(Date.now()-1000);
  await denied(()=>readAiCostDashboard(user.id),403);
  const unauth=await readRoute(new Request('http://localhost/api/admin/ai/costs'));assert.equal(unauth.status,401);
  const viewerResponse=await readRoute(await makeRequest(reader));assert.equal(viewerResponse.status,200);assert.equal((await viewerResponse.json()).settings.source,'ENVIRONMENT');
  const forbidden=await writeRoute(await makeRequest(reader,'POST',{type:'budget',value:{currency:'USD',siteLimit:1,userLimit:null,isActive:true,version:0,reason:'无权配置'}}));assert.equal(forbidden.status,403);

  const saved=await saveAiDailyCostBudget(manager.id,{currency:'USD',siteLimit:1,userLimit:0.5,isActive:true,version:0,reason:'设置隔离日预算'});
  assert.equal(saved.version,1);assert.equal((await readAiDailyBudgetConfiguration(db)).source,'DATABASE');assert.deepEqual((await readAiDailyBudgetConfiguration(db)).budgets.USD,{site:1,user:0.5});
  await denied(()=>saveAiDailyCostBudget(manager.id,{currency:'usd',siteLimit:1,userLimit:null,isActive:true,version:0,reason:'格式验证'}),400);
  const auditCount=await db.adminAuditLog.count();
  await denied(()=>saveAiDailyCostBudget(manager.id,{currency:'USD',siteLimit:2,userLimit:null,isActive:true,version:0,reason:'过期版本'}),409);
  assert.equal(await db.adminAuditLog.count(),auditCount);

  const currentPolicy=await readAiCostDashboard(reader.id);assert.equal(currentPolicy.settings.circuitBreaker,'disabled');
  const enabled=await saveAiCostCircuitBreaker(manager.id,{enabled:true,version:0,reason:'启用成本熔断隔离测试'});assert.equal(enabled.version,1);
  assert.equal((await readAiDailyBudgetConfiguration(db)).circuitBreaker,'enabled');
  const admitted=await db.$transaction(tx=>readCostBudgetBlock(tx,user.id,new Date(),'USD'));assert.equal(admitted,null);

  await db.aiCall.create({data:{userId:user.id,conversationId:'budget-known-fixture',operation:'SEND',status:'SUCCEEDED',model:'cost-fixture',attempts:1,inputTokens:1000,outputTokens:1000,estimatedCost:1.25,currency:'USD',startedAt:fixtureStartedAt}});
  assert.equal((await readAiDailyBudgetConfiguration(db)).budgets.USD.site,1);
  const groupCheck=await db.aiCall.groupBy({by:['attempts'],where:{currency:'USD',startedAt:{gte:new Date(new Date().setUTCHours(0,0,0,0)),lte:new Date()},status:{notIn:['MOCK','STARTED']}},_count:{_all:true,estimatedCost:true},_sum:{estimatedCost:true}});assert.equal(groupCheck[0]._sum.estimatedCost,1.25);
  const knownBlocked=await db.$transaction(tx=>readCostBudgetBlock(tx,user.id,new Date(),'USD'));assert.equal(knownBlocked.code,'AI_COST_BUDGET');assert.equal(knownBlocked.scope,'site');
  const raised=await saveAiDailyCostBudget(manager.id,{currency:'USD',siteLimit:10,userLimit:0.5,isActive:true,version:1,reason:'扩大隔离测试预算'});assert.equal(raised.version,2);
  await db.aiCall.create({data:{userId:user.id,conversationId:'budget-unknown-fixture',operation:'SEND',status:'FAILED',model:'cost-fixture',attempts:2,estimatedCost:0.25,currency:'USD',startedAt:fixtureStartedAt}});
  const unknownBlocked=await db.$transaction(tx=>readCostBudgetBlock(tx,user.id,new Date(),'USD'));assert.equal(unknownBlocked.code,'AI_COST_UNKNOWN');
  const dashboard=await readAiCostDashboard(manager.id,7);assert.equal(dashboard.costs.find(row=>row.currency==='USD').unknownCostCalls,1);assert.equal(dashboard.settings.rows[0].version,2);
  const routeSave=await writeRoute(await makeRequest(manager,'POST',{type:'budget',value:{currency:'CAD',siteLimit:3,userLimit:null,isActive:true,version:0,reason:'HTTP保存预算'}}));assert.equal(routeSave.status,200);assert.equal((await routeSave.json()).currency,'CAD');

  await denied(()=>saveAiCostCircuitBreaker(manager.id,{enabled:false,version:0,reason:'过期策略'}),409);
  const disabled=await saveAiCostCircuitBreaker(manager.id,{enabled:false,version:enabled.version,reason:'关闭隔离熔断'});assert.equal(disabled.enabled,false);
  assert.equal(await db.adminAuditLog.count({where:{action:{in:['CREATE_AI_COST_BUDGET','UPDATE_AI_COST_BUDGET','CREATE_AI_COST_POLICY','UPDATE_AI_COST_POLICY']}}}),5);
});

