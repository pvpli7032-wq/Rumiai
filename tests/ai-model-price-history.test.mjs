import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const file=`ai-model-price-history-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL=`file:./${file}`;
process.env.JWT_SECRET=randomUUID()+randomUUID();
process.env.MODERATOR_USER_IDS='';process.env.PAYMENT_ADMIN_USER_IDS='';
process.env.AI_BUDGET_CIRCUIT_BREAKER='false';process.env.AI_PRICE_MODEL='fixture-model';
process.env.AI_INPUT_PRICE_PER_MILLION='';process.env.AI_OUTPUT_PRICE_PER_MILLION='';
const env={...process.env};delete env.RUST_LOG;
const migration=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});
assert.equal(migration.status,0,migration.stdout+migration.stderr);

const {db}=await import('../src/lib/db.ts');
const {bootstrapOwner,saveOperator}=await import('../src/lib/admin/management-service.ts');
const {readAiModelPriceSettings,saveAiModelPrice,readCurrentAiModelPrices,estimateAiCostFromPrice}=await import('../src/lib/ai/costs/model-price-service.ts');
const {readAiModelPriceCoverage}=await import('../src/lib/ai/costs/model-price-service.ts');
const {saveAiCostCircuitBreaker,saveAiDailyCostBudget}=await import('../src/lib/ai/costs/budget-service.ts');
const {readAiCostDashboard}=await import('../src/lib/ai/costs/budget-service.ts');
const {finishAiCall}=await import('../src/lib/ai/ai-usage.ts');
const {signToken}=await import('../src/lib/auth.ts');
const {GET,POST}=await import('../src/app/api/admin/ai/prices/route.ts');
const user=async username=>db.user.create({data:{username,email:`${username}@example.invalid`,passwordHash:await bcrypt.hash(randomUUID(),4)}});
const owner=await user(`price_owner_${process.pid}`),manager=await user(`price_manager_${process.pid}`),ordinary=await user(`price_user_${process.pid}`);
await bootstrapOwner(owner.email);
const role=await db.adminRole.findUniqueOrThrow({where:{code:'AI_COST_MANAGER'}});
await saveOperator(owner.id,{userId:manager.id,enabled:true,version:0,roleIds:[role.id],reason:'模型价格历史测试'});
const tokenFor=async actor=>`Bearer ${await signToken({userId:actor.id,email:actor.email,tokenVersion:actor.tokenVersion})}`;
const request=async(actor,method='GET',body)=>new Request('http://localhost/api/admin/ai/prices',{method,headers:{Authorization:await tokenFor(actor),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const provider=await db.aiProvider.create({data:{name:`price-provider-${process.pid}`,baseUrl:'https://provider.example.invalid/v1',isActive:true}});
const model=await db.aiModel.create({data:{key:`price-model-${process.pid}`,displayName:'价格测试模型',modelCode:'provider-model-v1',providerId:provider.id,isActive:true,isDefault:true,defaultSlot:`PRICE-${process.pid}`}});
const secondaryModel=await db.aiModel.create({data:{key:`price-secondary-${process.pid}`,displayName:'未定价测试模型',modelCode:'provider-model-secondary',providerId:provider.id,isActive:true}});
const now=Date.now(),effective=new Date(now-60_000),next=new Date(now+86_400_000),callAt=new Date(now-30_000);

test.after(async()=>{await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])rmSync(path.resolve('prisma',file+suffix),{force:true});});

test('model price APIs enforce authentication and management permission',async()=>{
  assert.equal((await GET(new Request('http://localhost/api/admin/ai/prices'))).status,401);
  assert.equal((await GET(await request(ordinary))).status,403);
  assert.equal((await POST(await request(ordinary,'POST',{modelId:model.id}))).status,403);
  await assert.rejects(()=>saveAiModelPrice(manager.id,{modelId:model.id,currency:'usd',inputPricePerMillion:'1',outputPricePerMillion:'1',effectiveAt:effective.toISOString(),source:'provider sheet',reason:'reject lowercase'}),error=>error.status===400);
});

test('price versions and usage snapshot',async()=>{
  await assert.rejects(()=>saveAiModelPrice(manager.id,{modelId:model.id,currency:'USD',inputPricePerMillion:'1',outputPricePerMillion:'1',effectiveAt:'2026-02-31T00:00:00Z',source:'invalid date',reason:'invalid UTC date'}),error=>error.status===400);
  const first=await saveAiModelPrice(manager.id,{modelId:model.id,currency:'USD',inputPricePerMillion:'1.250000',outputPricePerMillion:'4.5',effectiveAt:effective.toISOString(),source:'provider pricing page v1',reason:'记录合成旧版价格'});
  assert.equal(first.inputPricePerMillion,'1.25');
  const second=await saveAiModelPrice(manager.id,{modelId:model.id,currency:'CAD',inputPricePerMillion:'7',outputPricePerMillion:'9.125',effectiveAt:next.toISOString(),source:'provider contract v2',reason:'记录未来合成价格'});
  assert.equal(second.currency,'CAD');
  await assert.rejects(()=>saveAiModelPrice(manager.id,{modelId:model.id,currency:'USD',inputPricePerMillion:'2',outputPricePerMillion:'3',effectiveAt:new Date(now).toISOString(),source:'late historical insert',reason:'must not rewrite history'}),error=>error.status===409);
  const atCall=await readCurrentAiModelPrices(db,[model.key],callAt);assert.equal(atCall[0].price.id,first.id);
  const coverage=await readAiModelPriceCoverage(db,new Date(),[model.key]);assert.deepEqual(coverage.currencies,['USD']);assert.equal(coverage.complete,true);
  const call=await db.aiCall.create({data:{userId:ordinary.id,conversationId:'price-history-fixture',operation:'SEND',status:'STARTED',currency:'USD',startedAt:callAt}});
  const finished=await finishAiCall(call.id,callAt,'SUCCEEDED',{model:'provider-model-v1',modelKey:model.key,attempts:1,inputTokens:1000,outputTokens:2000});
  assert.equal(finished.modelPriceId,first.id);assert.equal(finished.currency,'USD');assert.equal(finished.estimatedCost,0.01025);
  await db.aiCall.create({data:{userId:ordinary.id,conversationId:'unpriced-model-fixture',operation:'SEND',status:'FAILED',model:'provider-model-v2',attempts:2,currency:'USD',startedAt:new Date(now-15_000)}});
  const report=await readAiCostDashboard(manager.id,7),priced=report.modelCosts.find(row=>row.modelKey===model.key),unknown=report.modelCosts.find(row=>row.providerModelCode==='provider-model-v2');
  assert.equal(priced.estimatedCost,0.01025);assert.equal(priced.knownCostCalls,1);assert.equal(unknown.unknownCostCalls,1);
  assert.equal(estimateAiCostFromPrice(undefined,1,1n,1n),null);
  const settings=await readAiModelPriceSettings(owner.id);assert.equal(settings.models[0].prices.length,2);assert.doesNotThrow(()=>JSON.stringify(settings));
  assert.equal((await GET(await request(owner))).status,200);
  const saveResponse=await POST(await request(manager,'POST',{modelId:model.id,currency:'EUR',inputPricePerMillion:'0.000001',outputPricePerMillion:'12.345678',effectiveAt:new Date(now+172_800_000).toISOString(),source:'provider pricing page v3',reason:'HTTP管理新增价格版本'}));
  assert.equal(saveResponse.status,201);assert.equal((await saveResponse.json()).inputPricePerMillion,'0.000001');
  assert.equal(await db.aiModelPrice.count({where:{modelId:model.id}}),3);
  assert.equal(await db.adminAuditLog.count({where:{action:'CREATE_AI_MODEL_PRICE'}}),3);
  await saveAiDailyCostBudget(owner.id,{currency:'USD',siteLimit:100,userLimit:null,isActive:true,version:0,reason:'模型成本熔断配置测试'});
  const incomplete=await readAiModelPriceCoverage(db,new Date());assert.equal(incomplete.complete,false);assert.deepEqual(incomplete.unpricedModels,[secondaryModel.key]);
  await assert.rejects(()=>saveAiCostCircuitBreaker(owner.id,{enabled:true,version:0,reason:'漏配模型时不得启用熔断'}),error=>error.status===409);
  await saveAiModelPrice(manager.id,{modelId:secondaryModel.id,currency:'CAD',inputPricePerMillion:'2',outputPricePerMillion:'3',effectiveAt:effective.toISOString(),source:'isolated secondary provider price',reason:'补齐第二模型合成价格'});
  await assert.rejects(()=>saveAiCostCircuitBreaker(owner.id,{enabled:true,version:0,reason:'缺少CAD预算时不得启用熔断'}),error=>error.status===409);
  await saveAiDailyCostBudget(owner.id,{currency:'CAD',siteLimit:100,userLimit:null,isActive:true,version:0,reason:'配置第二模型对应币种预算'});
  const breaker=await saveAiCostCircuitBreaker(owner.id,{enabled:true,version:0,reason:'已具备模型价格和预算'});assert.equal(breaker.enabled,true);
});
