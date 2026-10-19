import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import cp from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let ts;try{ts=require('typescript')}catch{ts=require(path.join(cp.execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript'))}
const file='src/lib/conversations/chat-application-service.ts';
const transpile=()=>ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
function harness(options={}){
 const state={calls:[],persisted:[],finished:[],replaced:[],reserveModes:[]};
 const conversation={id:'c1',userId:'u1',characterId:'role1',aiModel:null,character:{id:'role1',name:'Role',personality:'calm'}};
 class ConversationError extends Error{constructor(message,status){super(message);this.status=status}}
 class ConversationMessageError extends Error{constructor(message,status){super(message);this.status=status}}
 class AiQuotaError extends Error{constructor(message,status=429,retryAfter=0){super(message);this.status=status;this.retryAfter=retryAfter}}
 const deps={
  '@/lib/logger':{logRouteError:()=>{}},
  '@/lib/conversations/conversation-service':{ConversationError,readConversationForChat:async()=>{state.calls.push('authorize');return conversation}},
  '@/lib/conversations/message-service':{ConversationMessageError,createUserMessage:async(id,content)=>{state.calls.push('createUser');if(options.failCreate)throw Error('write fail');state.persisted.push(content);return{id:'u-msg'}},readRecentMessageHistory:async()=>{state.calls.push('history');return[]},prepareMessageRegeneration:async()=>({prompt:{content:'again',createdAt:new Date('2026-01-01')},history:[]}),persistAssistantResponse:async(id,cid,content)=>{state.calls.push('persist');if(options.failPersist)throw Error('persist fail');state.persisted.push(content);return null},replaceMessageReply:async(...args)=>{state.replaced.push(args);return null}},
  '@/lib/launch-guards':{isAiChatAvailable:()=>options.available??true},
  '@/lib/rate-limit':{checkRateLimit:()=>{state.calls.push('rate');return options.rate??{allowed:true,retryAfter:9}}},
  '@/lib/ai/ai-usage':{AiQuotaError,reserveAiCall:async(u,c,mode)=>{state.calls.push('reserve');state.reserveModes.push(mode);return{id:'call1',startedAt:new Date()}},finishAiCall:async(...args)=>{state.calls.push('finish');state.finished.push(args)}},
  '@/lib/conversations/chat-stream':{aiErrorCode:e=>e?.name==='AbortError'?'CANCELLED':'UPSTREAM_ERROR',aiUserError:()=> 'AI 服务暂时不可用，请稍后重试。',streamOpenAIResponse:async(controller,character,history,content,model,opts)=>{state.calls.push('generate');if(options.abortWait)return await new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true}));if(options.failGenerate)throw Error('upstream');controller.enqueue(new TextEncoder().encode('data: {"content":"reply"}\n\n'));return'reply'},streamMockResponse:async(controller)=>{state.calls.push('generate');controller.enqueue(new TextEncoder().encode('data: {"demo":true}\n\n'));return'reply'}},
  '@/lib/ai/types':{},'@/lib/ai/config':{HISTORY_TURNS:20,CHAT_LIMIT:30,CHAT_WINDOW_MS:60000},
  '@/lib/ai/providers/management-service':{readActiveAiProviders:async()=>[]},
  '@/lib/ai/models/runtime-service':{readAiModelPlan:async()=>null},
 };
 const mod={exports:{}};const process={env:options.env??{NODE_ENV:'development',DISABLE_MOCK_AI:'false'}};
 const wrapper=vm.runInNewContext('(function(require,module,exports,process,ReadableStream,TextEncoder,AbortController,DOMException){'+transpile()+'\n})',{ReadableStream,TextEncoder,AbortController,DOMException,Headers});
 wrapper(name=>{if(!(name in deps))throw Error('Unknown dependency '+name);return deps[name]},mod,mod.exports,process,ReadableStream,TextEncoder,AbortController,DOMException);
 return{service:mod.exports,state};
}
const req=(mode,input,signal=new AbortController().signal)=>({userId:'u1',conversationId:'c1',mode,input,signal});
async function body(result){const reader=result.stream.getReader();let text='';for(;;){const r=await reader.read();if(r.done)break;text+=new TextDecoder().decode(r.value)}return text}
test('SEND validates blank, oversized, and malformed JSON before rate/reserve/write',async()=>{
 for(const [input,message] of [[{request:new Request('http://local',{method:'POST',body:JSON.stringify({content:'   '})})},'Message content is required'],[{request:new Request('http://local',{method:'POST',body:JSON.stringify({content:'x'.repeat(5001)})})},'消息须为文本，最多 5000 字。'],[{request:new Request('http://local',{method:'POST',body:'{'})},'消息数据格式不正确。']]){
  const h=harness();await assert.rejects(h.service.executeChatTurn(req('SEND',input)),e=>e.status===400&&e.message===message);assert.equal(h.state.reserveModes.length,0);assert.equal(h.state.persisted.length,0);assert.deepEqual(h.state.calls,['authorize']);
 }
});
test('SEND and REGENERATE retain distinct unavailable-AI copy',async()=>{
 for(const [mode,input,message] of [['SEND',{request:new Request('http://local',{method:'POST',body:JSON.stringify({content:'hi'})})},'AI 服务未配置，暂时无法聊天。'],['REGENERATE',{targetMessageId:'m1'},'AI 服务未配置，暂时无法重新生成回复。']]){const h=harness({available:false});await assert.rejects(h.service.executeChatTurn(req(mode,input)),e=>e.status===503&&e.message===message);assert.equal(h.state.reserveModes.length,0)}
});
test('rate limited turn carries Retry-After and does not reserve',async()=>{const h=harness({rate:{allowed:false,retryAfter:17}});await assert.rejects(h.service.executeChatTurn(req('SEND',{request:new Request('http://local',{method:'POST',body:JSON.stringify({content:'hi'})})})),e=>e.status===429&&e.headers['Retry-After']==='17');assert.equal(h.state.reserveModes.length,0)});
test('SEND and REGENERATE reserve their own call modes',async()=>{for(const [mode,input] of [['SEND',{request:new Request('http://local',{method:'POST',body:JSON.stringify({content:'hi'})})}],['REGENERATE',{targetMessageId:'m1'}]]){const h=harness();await body(await h.service.executeChatTurn(req(mode,input)));assert.deepEqual(h.state.reserveModes,[mode])}});
test('signal abort cancels generation, persists empty send reply, settles CANCELLED, and does not close twice',async()=>{
 const h=harness({env:{NODE_ENV:'production',OPENAI_API_KEY:'key'},abortWait:true});const aborter=new AbortController();const result=await h.service.executeChatTurn(req('SEND',{request:new Request('http://local',{method:'POST',body:JSON.stringify({content:'hi'})})},aborter.signal));const reader=result.stream.getReader();const pending=reader.read();await new Promise(resolve=>setTimeout(resolve,10));await reader.cancel();aborter.abort();await pending.catch(()=>{});await new Promise(resolve=>setTimeout(resolve,10));assert.deepEqual(h.state.persisted,['hi','']);assert.equal(h.state.finished.at(-1)[2],'CANCELLED');assert.equal(h.state.replaced.length,0);
});
test('failed regeneration never replaces the old reply',async()=>{const h=harness({env:{NODE_ENV:'production',OPENAI_API_KEY:'key'},failGenerate:true});const result=await h.service.executeChatTurn(req('REGENERATE',{targetMessageId:'m1'}));const text=await body(result);assert.match(text,/原回复已保留。/);assert.equal(h.state.replaced.length,0);assert.equal(h.state.finished.at(-1)[2],'FAILED')});
test('persistence failure settles FAILED with PERSISTENCE_ERROR and emits send-specific copy',async()=>{const h=harness({failPersist:true});const result=await h.service.executeChatTurn(req('SEND',{request:new Request('http://local',{method:'POST',body:JSON.stringify({content:'hi'})})}));const text=await body(result);assert.match(text,/聊天记录保存失败，请刷新后确认。/);assert.equal(h.state.finished.at(-1)[2],'FAILED');assert.equal(h.state.finished.at(-1)[4],'PERSISTENCE_ERROR')});
