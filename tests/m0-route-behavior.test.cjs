// Dependency-light route behavior tests. Only TypeScript (installed after `npm ci`
// or via a global tsc) is needed; Next/Prisma are replaced by controlled stubs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const cp = require('node:child_process');
let ts;
try { ts = require('typescript'); }
catch {
  try { ts = require(path.join(cp.execFileSync('npm', ['root','-g'], {encoding:'utf8'}).trim(), 'typescript')); }
  catch { throw new Error('TypeScript is needed: install dependencies with npm ci before running this test.'); }
}
const transpile = (name) => ts.transpileModule(fs.readFileSync(name, 'utf8'), {
  fileName: name,
  compilerOptions: {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}
}).outputText;

function load(name, resolve, env, extra = {}) {
  const mod={exports:{}};
  vm.runInNewContext(`(function(require,module,exports,process,Response,ReadableStream,TextEncoder){${transpile(name)}\n})`, {
    Response, ReadableStream, TextEncoder, TextDecoder, setTimeout, clearTimeout, AbortController, AbortSignal, DOMException, fetch: extra.fetch || fetch,
  })(resolve,mod,mod.exports,{env},Response,ReadableStream,TextEncoder);
  return mod.exports;
}
const policy=load('src/lib/launch-guards.ts',()=>{throw Error('unexpected import')},{});
const baseAuth={getAuthUser:async()=>({userId:'u1'})};
const output={json:(obj,options={})=>({status:options.status??200, body:obj,headers:options.headers??{}})};
const next={NextResponse:output};

function fakeDeps(env,{throwAI=false,persistGate=null,throwPersist=false,reviewStatus="APPROVED",providers=[],modelPlan=null,modelCatalog={source:'ENV',models:['stub-model'],labels:{'stub-model':'stub-model'},default:'stub-model'}}={}){
  const state={created:[],deletes:0,mockCalls:0,chatCalls:0,updates:0,providersPassed:undefined,modelsPassed:undefined};
  const conversation={id:'c1',userId:'u1',characterId:'role1',character:{id:'role1',name:'Role',personality:'patient',isPublic:true,reviewStatus},aiModel:null};
  const db={
    conversation:{findUnique:async()=>conversation,update:async({data})=>{state.updates++;state.conversationUpdate=data;return {id:'c1',aiModel:data.aiModel??null}}},
    character:{update:async()=>({})},
    message:{
      findUnique:async({where}) => where.id==='reply1' ? {id:'reply1',conversationId:'c1',role:'ASSISTANT',createdAt:new Date('2026-01-02')} : {id:'question1',content:'hi',createdAt:new Date('2026-01-01')},
      findFirst:async()=>({id:'question1',content:'hi',createdAt:new Date('2026-01-01')}),
      findMany:async()=>[],
      create:async({data})=>{
        if(data.role==='ASSISTANT') {
          if(persistGate) await persistGate;
          if(throwPersist) throw Error('database write failed');
        }
        state.created.push(data);return {id:'new1',...data};
      },
      deleteMany:async()=>{state.deletes++;return {count:1}},
    },
    $transaction:async operations=>Promise.all(operations),
  };
  const streamMockResponse=async(controller)=>{
    state.mockCalls++;
    controller.enqueue(new TextEncoder().encode('data: {"content":"fake"}\\n\\n'));
    controller.enqueue(new TextEncoder().encode('data: [DONE]\\n\\n'));
    return 'fake';
  };
  const streamOpenAIResponse=async(...args)=>{state.chatCalls++;state.providersPassed=args[5]?.providers;state.modelsPassed=args[5]?.models;if(throwAI) throw Error('upstream down');return 'AI result';};
  // 聊天规则改由设置中心读取；这里给固定值，路由用例不依赖数据库设置。
  const chatRules={maxMessageChars:5000,historyMessages:20,perWindow:30,windowMs:60000};
  const service={streamMockResponse,streamOpenAIResponse,aiErrorCode:()=>"UPSTREAM_ERROR",aiUserError:()=>"AI 服务暂时不可用，请稍后重试。"};
  class ConversationError extends Error { constructor(message,status){super(message);this.status=status;} }
  const stubs={
    'next/server':next,'@/lib/db':{db},'@/lib/logger':{logRouteError:()=>{}, logWarning:()=>{}},
    '@/lib/auth':baseAuth,'@/lib/rate-limit':{checkRateLimit:()=>({allowed:true})},
    '@/lib/settings':{readChatRules:async()=>chatRules},
    // 记忆注入与计费粘合层不属于路由行为用例：按「无记忆、不收费」返回。
    '@/lib/memory':{buildMemoryContext:async()=>({text:null}),enqueueSummaryIfDue:async()=>{}},
    '@/lib/billing/turn':{beginBillingTurn:async party=>({requestId:party.requestId,hold:{held:false},sawOutput(){},deliveredOutput(){return false},notice(){return null},release:async()=>{},settle:async()=>{}}),parseJsonBody:async request=>request?request.clone().json().then(body=>body&&typeof body==='object'?body:null).catch(()=>null):null,readBalance:async()=>0,readTurnReceipt:async()=>null,readRequestId:raw=>typeof raw==='string'&&/^[A-Za-z0-9_-]{8,64}$/.test(raw)?raw:null,toChargeError:()=>null},
    '@/lib/conversations/chat-stream':service,'@/lib/ai/providers/management-service':{readActiveAiProviders:async()=>providers},'@/lib/ai/models/runtime-service':{readAiModelPlan:async()=>modelPlan,readAiModelCatalog:async()=>modelCatalog},'@/lib/growth/invite-service':{grantInviteRewardIfDue:async()=>false},'@/lib/ai/ai-usage':{AiQuotaError:class AiQuotaError extends Error{},reserveAiCall:async()=>({id:'usage1',startedAt:new Date()}),finishAiCall:async()=>{}},'@/lib/launch-guards':policy,
    '@/lib/conversations/conversation-service':{
      ConversationError,
      readConversationForChat: async(userId,id)=>{
        if(id!==conversation.id)throw new ConversationError('Not found',404);
        if(userId!==conversation.userId)throw new ConversationError('Forbidden',403);
        if((!conversation.character.isPublic||conversation.character.reviewStatus!=='APPROVED')&&conversation.character.creatorId!==userId)throw new ConversationError('Private',403);
        return conversation;
      },
      updateConversation: async(userId,id,input)=>{
        if(id!==conversation.id)throw new ConversationError('Not found',404);
        if(userId!==conversation.userId)throw new ConversationError('Forbidden',403);
        const model=input.aiModel??input.ai_model;
        if(model!==undefined&&model!==null&&!modelCatalog.models.includes(model))throw new ConversationError('invalid model',400);
        state.conversationUpdate={id,aiModel:model??null};
        return {conversation:state.conversationUpdate};
      },
      readConversation: async()=>({conversation}), deleteConversation: async()=>({success:true}),
      listUserConversations: async()=>[], createOrReuseConversation: async()=>({conversation}),
    },
    '@/lib/conversations/message-service':{
      ConversationMessageError: class ConversationMessageError extends Error { constructor(message,status){super(message);this.status=status;} },
      createUserMessage: async(conversationId,content)=>db.message.create({data:{conversationId,role:'USER',content}}),
      readRecentMessageHistory: async()=>[],
      readConversationMessages: async()=>[],
      prepareMessageRegeneration: async(userId,conversationId,messageId)=>({prompt:{id:'question1',content:'hi',createdAt:new Date('2026-01-01')},history:[]}),
      replaceMessageReply: async(conversationId,promptCreatedAt,content)=>{if(!content.trim())return null;await db.$transaction([db.message.deleteMany({where:{conversationId,createdAt:{gt:promptCreatedAt}}}),db.message.create({data:{conversationId,role:'ASSISTANT',content}}),db.conversation.update({where:{id:conversationId},data:{updatedAt:new Date()}})]);return {id:'new1',content};},
      persistAssistantResponse: async(conversationId,characterId,content)=>{
        const assistant=content.trim()?await db.message.create({data:{conversationId,role:'ASSISTANT',content}}):null;
        await db.conversation.update({where:{id:conversationId},data:{updatedAt:new Date()}});
        await db.character.update({where:{id:characterId},data:{messageCount:{increment:content.trim()?2:1}}});
        return assistant;
      },
    },
    '@/lib/payments/purchase-service':{
      SimulatedPurchaseError: class SimulatedPurchaseError extends Error { constructor(message,status){super(message);this.status=status;} },
      simulateCoinPurchase: async()=>{ if(!policy.maySimulatePurchase(env)) throw new stubs['@/lib/payments/purchase-service'].SimulatedPurchaseError('充值功能暂未开放；该接口仅供本地测试，未接入真实支付。',503); return {success:true,newBalance:60,coinsAdded:60}; },
    },
  };
  // 聊天回合编排已抽到 chat-application-service，路由只留 HTTP 层。这里必须加载真实服务
  // 而不是给它塞一个替身：否则「没有 AI 密钥时不写消息/不扣额度」这类断言会变成空转。
  const loaded=new Map();
  const requireStub=name=>{
    if(name==='@/lib/conversations/chat-application-service'){
      const file='src/lib/conversations/chat-application-service.ts';
      if(!loaded.has(file))loaded.set(file,load(file,requireStub,env));
      return loaded.get(file);
    }
    if(!(name in stubs))throw Error('Unknown dependency '+name);
    return stubs[name];
  };
  return {state,loadRoute:file=>load(file,requireStub,env)};
}
// V3 §20：请求号由客户端给，缺了服务端会 400；夹具统一补一个合法编号。
const req=(body)=>new Request('http://local.test/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'fixture-request-01',...body})});

// These assert route behavior, not merely that the policy helper returns a Boolean.
test('Production: no AI key returns HTTP 503 and writes no messages', async()=>{
  const ctx=fakeDeps({NODE_ENV:'production'});
  const route=ctx.loadRoute('src/app/api/conversations/[id]/messages/route.ts');
  const result=await route.POST(req({content:'hello'}),{params:{id:'c1'}});
  assert.equal(result.status,503);
  assert.equal(ctx.state.created.length,0);
  assert.equal(ctx.state.mockCalls,0);
});

test('Production: enabled database providers authorize chat and are passed to the real streaming service',async()=>{
  const providers=[{id:'provider-1',name:'fixture',baseUrl:'https://api.example.invalid/v1',apiKey:'database-secret-fixture'}];
  const ctx=fakeDeps({NODE_ENV:'production'},{providers});const route=ctx.loadRoute('src/app/api/conversations/[id]/messages/route.ts');
  const result=await route.POST(req({content:'hello'}),{params:{id:'c1'}});assert.equal(result.status,200);await result.body.getReader().read();
  assert.equal(ctx.state.chatCalls,1);assert.deepEqual(ctx.state.providersPassed,providers);assert.equal(ctx.state.mockCalls,0);
});

test('Production: enabled database model routes pass provider/model limits to the real streaming service',async()=>{
  const models=[{key:'chat-primary',modelCode:'vendor-model-a',provider:{id:'provider-a',name:'fixture',baseUrl:'https://api.example.invalid/v1',apiKey:'model-secret-fixture'},timeoutMs:12000,maxRetries:2,maxOutputTokens:1200,isDefault:true,isFallback:false,sortOrder:0}];
  const ctx=fakeDeps({NODE_ENV:'production'},{modelPlan:models});const route=ctx.loadRoute('src/app/api/conversations/[id]/messages/route.ts');const result=await route.POST(req({content:'hello'}),{params:{id:'c1'}});assert.equal(result.status,200);await result.body.getReader().read();assert.equal(ctx.state.chatCalls,1);assert.deepEqual(ctx.state.modelsPassed,models);assert.equal(ctx.state.providersPassed?.length,0);assert.equal(ctx.state.mockCalls,0);
});

test('Conversation model selection validates only the server-managed model catalog',async()=>{
  const catalog={source:'DATABASE',models:['chat-primary'],labels:{'chat-primary':'角色对话标准版'},default:'chat-primary'};const ctx=fakeDeps({NODE_ENV:'production'},{modelCatalog:catalog});const route=ctx.loadRoute('src/app/api/conversations/[id]/route.ts');
  const request=model=>new Request('http://local.test/api/conversations/c1',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({aiModel:model})});
  const valid=await route.PATCH(request('chat-primary'),{params:{id:'c1'}});assert.equal(valid.status,200);assert.equal(ctx.state.conversationUpdate.aiModel,'chat-primary');const updates=ctx.state.updates;
  const invalid=await route.PATCH(request('arbitrary-expensive-model'),{params:{id:'c1'}});assert.equal(invalid.status,400);assert.equal(ctx.state.updates,updates);
});

test('Production: upstream failure emits an error, not a scripted reply', async()=>{
  const ctx=fakeDeps({NODE_ENV:'production',OPENAI_API_KEY:'real-like-key'}, {throwAI:true});
  const route=ctx.loadRoute('src/app/api/conversations/[id]/messages/route.ts');
  const result=await route.POST(req({content:'hello'}),{params:{id:'c1'}});
  assert.equal(result.status,200);
  const txt=await result.text();
  assert.match(txt,/AI 服务暂时不可用/);
  assert.equal(ctx.state.mockCalls,0);
  assert.equal(ctx.state.created.filter(x=>x.role==='ASSISTANT').length,0);
  assert.equal(ctx.state.created.filter(x=>x.role==='USER').length,1);
});

test('Production: failed regeneration does not delete existing reply', async()=>{
  const ctx=fakeDeps({NODE_ENV:'production',OPENAI_API_KEY:'real-like-key'}, {throwAI:true});
  const route=ctx.loadRoute('src/app/api/conversations/[id]/messages/[messageId]/regenerate/route.ts');
  const result=await route.POST(req({}),{params:{id:'c1',messageId:'reply1'}});
  assert.equal(result.status,200);
  assert.match(await result.text(),/原回复已保留/);
  assert.equal(ctx.state.deletes,0);
  assert.equal(ctx.state.mockCalls,0);
});

test('Production: even ALLOW_SIMULATED_PURCHASES=true cannot mint coins', async()=>{
  const ctx=fakeDeps({NODE_ENV:'production',ALLOW_SIMULATED_PURCHASES:'true'});
  const route=ctx.loadRoute('src/app/api/coins/purchase/route.ts');
  const result=await route.POST(req({packageId:'1'}));
  assert.equal(result.status,503);
  assert.equal(ctx.state.created.length,0);
});

test('Development: configured upstream errors never switch to demo replies',async()=>{
  const ctx=fakeDeps({NODE_ENV:'development',OPENAI_API_KEY:'stub-key'},{throwAI:true});
  const route=ctx.loadRoute('src/app/api/conversations/[id]/messages/route.ts');
  const result=await route.POST(req({content:'hello'}),{params:{id:'c1'}});
  assert.match(await result.text(),/AI 服务暂时不可用/);
  assert.equal(ctx.state.mockCalls,0);
});

test('SSE: completion waits for the assistant database commit',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve});
  const ctx=fakeDeps({NODE_ENV:'production',OPENAI_API_KEY:'stub-key'},{persistGate:gate});
  const route=ctx.loadRoute('src/app/api/conversations/[id]/messages/route.ts');
  const response=await route.POST(req({content:'hello'}),{params:{id:'c1'}});
  const reader=response.body.getReader();
  let emitted=false;
  const firstRead=reader.read().then(value=>{emitted=true;return value});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(emitted,false,'DONE must not precede persistence');
  release();
  const first=await firstRead;
  assert.match(new TextDecoder().decode(first.value),/\[DONE\]/);
  assert.equal(ctx.state.created.filter(x=>x.role==='ASSISTANT').length,1);
  await reader.cancel();
});

test('SSE: persistence failure is a visible error rather than success',async()=>{
  const ctx=fakeDeps({NODE_ENV:'production',OPENAI_API_KEY:'stub-key'},{throwPersist:true});
  const route=ctx.loadRoute('src/app/api/conversations/[id]/messages/route.ts');
  const response=await route.POST(req({content:'hello'}),{params:{id:'c1'}});
  const body=await response.text();
  assert.match(body,/聊天记录保存失败/);
  assert.doesNotMatch(body,/\[DONE\]/);
});

function streamService(fetchStub) {
  const env={OPENAI_API_KEY:'stub-key',AI_MODEL:'stub-model'};
  return load('src/lib/conversations/chat-stream.ts', name => {
    if(name==='@/lib/db') return {db:{}};
    if(name==='@/lib/logger') return {logRouteError:()=>{},logWarning:()=>{}};
    if(name==='@/lib/ai/config') return {readAiInteger:(key,fallback,min,max)=>{const value=Number(env[key]);return Number.isInteger(value)&&value>=min&&value<=max?value:fallback}};
    if(name==='@/lib/ai/ai-models') return load('src/lib/ai/ai-models.ts', () => { throw Error('Unexpected model dependency'); }, env);
    throw Error('Unknown dependency '+name);
  }, env, {fetch:fetchStub});
}

test('Upstream: an empty successful SSE response is rejected',async()=>{
  const service=streamService(async()=>new Response('data: [DONE]\n\n'));
  await assert.rejects(service.streamOpenAIResponse({enqueue:()=>{}},{name:'角色',personality:'温和'},[],'你好'),/EMPTY_RESPONSE/);
});

test('Upstream: a interrupted partial reply fails instead of replacing history',async()=>{
  let reads=0;
  const service=streamService(async()=>new Response(new ReadableStream({
    pull(controller) {
      if(reads++===0) controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"半句"}}]}\n\n'));
      else controller.error(new Error('upstream disconnected'));
    }
  })));
  const events=[];
  await assert.rejects(service.streamOpenAIResponse({enqueue:chunk=>events.push(new TextDecoder().decode(chunk))},{name:'角色',personality:'温和'},[],'你好'),/disconnected/);
  assert.match(events.join(''),/半句/);
  assert.doesNotMatch(events.join(''),/\[DONE\]|demo/);
});

test('Demo: simulated content retains its label when saved and reloaded',async()=>{
  const service=streamService(async()=>{throw Error('should not call upstream')});
  const events=[];
  const content=await service.streamMockResponse({enqueue:chunk=>events.push(new TextDecoder().decode(chunk))},{name:'角色',personality:'温和'},'你好');
  assert.match(content,/^【模拟 AI 回复，仅供测试】/);
  assert.match(events.join(''),/"demo":true/);
  assert.doesNotMatch(events.join(''),/\[DONE\]/,'route owns completion after commit');
});

// Legacy import flags must never bypass the review gate.
test('Unreviewed legacy public flag cannot invoke AI through an existing room',async()=>{
 const ctx=fakeDeps({NODE_ENV:'development'},{reviewStatus:'PENDING'});
 const route=ctx.loadRoute('src/app/api/conversations/[id]/messages/route.ts');
 const result=await route.POST(req({content:'hello'}),{params:{id:'c1'}});
 assert.equal(result.status,403);assert.equal(ctx.state.created.length,0);assert.equal(ctx.state.mockCalls,0);
});