import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const file=`ai-providers-${process.pid}-${Date.now()}.db`,work=path.resolve('artifacts','ai-providers',file);
process.env.DATABASE_URL=`file:./${file}`;process.env.JWT_SECRET=randomUUID()+randomUUID();process.env.MODERATOR_USER_IDS='';process.env.PAYMENT_ADMIN_USER_IDS='';process.env.AI_PROVIDER_ENCRYPTION_KEY=randomBytes(32).toString('hex');
const env={...process.env};delete env.RUST_LOG;const migrated=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});assert.equal(migrated.status,0,migrated.stdout+migrated.stderr);
const {db}=await import('../src/lib/db.ts');const {bootstrapOwner,saveOperator,saveRole}=await import('../src/lib/admin/management-service.ts');const {readAiProviders,saveAiProvider,testAiProvider,readActiveAiProviders}=await import('../src/lib/ai/providers/management-service.ts');
const users=[];for(const username of ['ai_owner','ai_manager','ai_reader','ai_ordinary'])users.push(await db.user.create({data:{username,email:`${username}@example.invalid`,passwordHash:await bcrypt.hash(randomUUID(),4)}}));
const [owner,manager,reader,ordinary]=users;await bootstrapOwner(owner.email);const role=await db.adminRole.findUniqueOrThrow({where:{code:'AI_PROVIDER_MANAGER'}});await saveOperator(owner.id,{userId:manager.id,enabled:true,version:0,roleIds:[role.id],reason:'供应商隔离测试'});const readRole=await saveRole(owner.id,{name:'AI供应商只读',permissions:['ai.providers.read'],reason:'供应商权限测试'});await saveOperator(owner.id,{userId:reader.id,enabled:true,version:0,roleIds:[readRole.id],reason:'供应商权限测试'});
const denied=(fn,status)=>assert.rejects(fn,error=>error.status===status),secret=`fixture-${randomBytes(24).toString('hex')}`;
test.after(async()=>{await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])rmSync(path.resolve('prisma',file+suffix),{force:true});if(work.startsWith(path.resolve('artifacts','ai-providers')+path.sep))rmSync(work,{recursive:true,force:true});});

test('provider credentials are encrypted, permissioned, audited, masked and available only to the runtime',async()=>{
  await denied(()=>saveAiProvider(ordinary.id,{name:'x',baseUrl:'https://api.example.com/v1',isActive:false,sortOrder:0,reason:'越权'}),403);
  await denied(()=>saveAiProvider(reader.id,{name:'x',baseUrl:'https://api.example.com/v1',isActive:false,sortOrder:0,apiKey:secret,reason:'密钥越权'}),403);
  await denied(()=>saveAiProvider(manager.id,{name:'拒绝HTTP',baseUrl:'http://127.0.0.1:8443/v1',isActive:false,sortOrder:0,apiKey:secret,reason:'拒绝不安全地址'}),400);
  await denied(()=>saveAiProvider(manager.id,{name:'拒绝内网',baseUrl:'https://192.168.1.4/v1',isActive:false,sortOrder:0,apiKey:secret,reason:'拒绝IP地址'}),400);
  const created=await saveAiProvider(manager.id,{name:'兼容供应商',baseUrl:'https://api.example.com/v1/',protocol:'OPENAI_COMPATIBLE',isActive:true,sortOrder:1,apiKey:secret,reason:'登记隔离供应商'});
  assert.equal(created.hasSecret,true);assert.equal(JSON.stringify(created).includes(secret),false);assert.equal(Object.hasOwn(created,'secretCiphertext'),false);
  const stored=await db.aiProvider.findUniqueOrThrow({where:{id:created.id}});assert.notEqual(stored.secretCiphertext,secret);assert.equal(JSON.stringify(stored).includes(secret),false);
  const listed=await readAiProviders(reader.id);assert.equal(listed.length,1);assert.equal(listed[0].hasSecret,true);assert.equal(JSON.stringify(listed).includes(secret),false);
  assert.deepEqual((await readActiveAiProviders()).map(item=>({id:item.id,name:item.name,baseUrl:item.baseUrl,apiKey:item.apiKey})),[{id:created.id,name:'兼容供应商',baseUrl:'https://api.example.com/v1',apiKey:secret}]);
  const oldFetch=globalThis.fetch;let requestSeen;globalThis.fetch=async(url,init)=>{requestSeen={url:String(url),authorization:new Headers(init.headers).get('Authorization'),redirect:init.redirect};return new Response(JSON.stringify({data:[]}),{status:200,headers:{'content-type':'application/json'}});};
  let testResult;try{testResult=await testAiProvider(manager.id,created.id);}finally{globalThis.fetch=oldFetch;}
  assert.equal(testResult.reachable,true);assert.equal(testResult.authorized,true);assert.equal(testResult.status,200);assert(Number.isInteger(testResult.latencyMs));
  assert.equal(requestSeen.url,'https://api.example.com/v1/models');assert.equal(requestSeen.authorization,`Bearer ${secret}`);assert.equal(requestSeen.redirect,'error');
  const editable={name:'兼容供应商',baseUrl:'https://api.example.com/v1',protocol:'OPENAI_COMPATIBLE',isActive:true,sortOrder:1,version:created.version};
  await denied(()=>saveAiProvider(manager.id,{...editable,name:'改名',version:created.version-1,reason:'过期版本',id:created.id}),409);
  const updated=await saveAiProvider(manager.id,{...editable,id:created.id,isActive:false,sortOrder:2,clearSecret:true,reason:'停用并清除密钥'});assert.equal(updated.hasSecret,false);assert.equal(updated.isActive,false);assert.equal(await db.adminAuditLog.count({where:{action:{in:['CREATE_AI_PROVIDER','UPDATE_AI_PROVIDER','TEST_AI_PROVIDER']}}}),3);
});
