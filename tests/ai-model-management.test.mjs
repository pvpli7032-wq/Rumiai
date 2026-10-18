import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const file=`ai-models-${process.pid}-${Date.now()}.db`;process.env.DATABASE_URL=`file:./${file}`;process.env.JWT_SECRET=randomUUID()+randomUUID();process.env.MODERATOR_USER_IDS='';process.env.PAYMENT_ADMIN_USER_IDS='';process.env.AI_PROVIDER_ENCRYPTION_KEY=randomBytes(32).toString('hex');
const env={...process.env};delete env.RUST_LOG;const migrated=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});assert.equal(migrated.status,0,migrated.stdout+migrated.stderr);
const {db}=await import('../src/lib/db.ts');const {bootstrapOwner,saveOperator,saveRole}=await import('../src/lib/admin/management-service.ts');const {saveAiProvider}=await import('../src/lib/ai/providers/management-service.ts');const {readAiModels,saveAiModel,testAiModel}=await import('../src/lib/ai/models/management-service.ts');const {readAiModelCatalog,readAiModelPlan}=await import('../src/lib/ai/models/runtime-service.ts');
const users=[];for(const username of ['model_owner','model_manager','model_reader','model_ordinary'])users.push(await db.user.create({data:{username,email:`${username}@example.invalid`,passwordHash:await bcrypt.hash(randomUUID(),4)}}));
const [owner,manager,reader,ordinary]=users;await bootstrapOwner(owner.email);const modelRole=await db.adminRole.findUniqueOrThrow({where:{code:'AI_MODEL_MANAGER'}});await saveOperator(owner.id,{userId:manager.id,roleIds:[modelRole.id],enabled:true,version:0,reason:'模型路由测试'});const readRole=await saveRole(owner.id,{name:'模型只读',permissions:['ai.providers.read','ai.models.read'],reason:'模型只读测试'});await saveOperator(owner.id,{userId:reader.id,roleIds:[readRole.id],enabled:true,version:0,reason:'模型只读测试'});
const denied=(fn,status)=>assert.rejects(fn,error=>error.status===status),secret=`model-provider-${randomBytes(20).toString('hex')}`;const provider=await saveAiProvider(owner.id,{name:'模型测试供应商',baseUrl:'https://models.example.invalid/v1',isActive:true,sortOrder:0,apiKey:secret,reason:'模型路由隔离测试'});
test.after(async()=>{await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])rmSync(path.resolve('prisma',file+suffix),{force:true});});
const model=(overrides={})=>({key:'chat-standard',displayName:'标准聊天',modelCode:'provider-chat-v1',providerId:provider.id,isActive:true,isDefault:true,isFallback:false,sortOrder:0,timeoutMs:30000,maxRetries:1,maxOutputTokens:1200,reason:'建立默认路由',...overrides});

test('model routes enforce permissions/default/fallback invariants and drive the selectable/runtime catalogs',async()=>{
  await denied(()=>readAiModels(ordinary.id),403);await denied(()=>saveAiModel(ordinary.id,model()),403);await denied(()=>saveAiModel(reader.id,model()),403);
  const primary=await saveAiModel(manager.id,model());assert.equal(primary.isDefault,true);assert.equal(primary.isActive,true);
  const fallback=await saveAiModel(manager.id,model({key:'chat-backup',displayName:'备用聊天',modelCode:'provider-chat-v2',isDefault:false,isFallback:true,sortOrder:10,reason:'新增备用模型'}));
  let catalog=await readAiModelCatalog();assert.equal(catalog.source,'DATABASE');assert.deepEqual(catalog.models,['chat-standard','chat-backup']);assert.equal(catalog.default,'chat-standard');assert.equal(catalog.labels['chat-backup'],'备用聊天');
  let plan=await readAiModelPlan(fallback.key);assert.deepEqual(plan.map(item=>item.key),['chat-backup','chat-standard']);assert.equal(plan[0].provider.apiKey,secret);
  await denied(()=>saveAiModel(manager.id,{...model({id:primary.id,isActive:false,isDefault:false,version:primary.version,reason:'停用旧默认模型'})}),409);
  const selected=await saveAiModel(manager.id,model({key:'chat-third',displayName:'第三模型',modelCode:'provider-chat-v3',isDefault:true,isFallback:false,sortOrder:2,reason:'切换全站默认'}));
  assert.equal(selected.isDefault,true);let rows=await readAiModels(reader.id);assert.equal(rows.find(row=>row.key==='chat-standard').isDefault,false);assert.equal(rows.find(row=>row.key==='chat-third').isDefault,true);
  const updatedPrimary=rows.find(row=>row.id===primary.id);await denied(()=>saveAiModel(manager.id,model({id:primary.id,key:'renamed-key',version:updatedPrimary.version,isDefault:true,reason:'拒绝改逻辑键'})),409);
  await denied(()=>saveAiModel(manager.id,model({id:fallback.id,key:fallback.key,version:fallback.version-1,isDefault:false,isFallback:true,reason:'过期版本'})),409);
  await denied(()=>saveAiProvider(owner.id,{id:provider.id,name:provider.name,baseUrl:provider.baseUrl,protocol:provider.protocol,isActive:false,sortOrder:provider.sortOrder,version:provider.version,reason:'存在活跃模型不能停用'}),409);
  const oldFetch=globalThis.fetch;let requested;globalThis.fetch=async(url,init)=>{requested={url:String(url),auth:new Headers(init.headers).get('Authorization')};return new Response(JSON.stringify({data:[{id:'provider-chat-v3'}]}),{status:200});};let checked;try{checked=await testAiModel(manager.id,selected.id);}finally{globalThis.fetch=oldFetch;}
  assert.equal(checked.reachable,true);assert.equal(checked.authorized,true);assert.equal(checked.modelListed,true);assert.equal(requested.url,'https://models.example.invalid/v1/models');assert.equal(requested.auth,`Bearer ${secret}`);
  rows=await readAiModels(reader.id);assert.equal(rows.find(row=>row.id===selected.id).lastCheckStatus,'AVAILABLE');plan=await readAiModelPlan();assert.deepEqual(plan.map(item=>item.key),['chat-third','chat-backup']);
});
