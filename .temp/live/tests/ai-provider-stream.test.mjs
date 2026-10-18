import test from 'node:test';
import assert from 'node:assert/strict';
import {streamOpenAIResponse} from '../src/lib/conversations/chat-stream.ts';

test('chat streaming uses encrypted database provider configuration and fails over before exposing content',async()=>{
  const previous={key:process.env.AI_MAX_RETRIES,model:process.env.AI_MODEL};process.env.AI_MAX_RETRIES='0';process.env.AI_MODEL='provider-fixture-model';
  const oldFetch=globalThis.fetch,requests=[],chunks=[];let attempts=0;
  globalThis.fetch=async(url,init)=>{requests.push({url:String(url),authorization:new Headers(init.headers).get('Authorization'),body:JSON.parse(init.body)});attempts++;if(attempts===1)return new Response(JSON.stringify({error:{message:'quota'}}),{status:429});return new Response('data: {"choices":[{"delta":{"content":"provider reply"},"finish_reason":"stop"}] }\n\ndata: [DONE]\n\n',{status:200,headers:{'content-type':'text/event-stream'}});};
  try{
    const metrics={};const controller={enqueue(value){chunks.push(new TextDecoder().decode(value));}};
    const reply=await streamOpenAIResponse(controller,{name:'测试角色',personality:'测试设定'},[],'hello',null,{providers:[{id:'first',name:'first',baseUrl:'https://first.example/v1',apiKey:'first-secret-fixture'},{id:'second',name:'second',baseUrl:'https://second.example/v1',apiKey:'second-secret-fixture'}],onMetrics:value=>Object.assign(metrics,value)});
    assert.equal(reply,'provider reply');assert.deepEqual(requests.map(item=>item.url),['https://first.example/v1/chat/completions','https://second.example/v1/chat/completions']);assert.deepEqual(requests.map(item=>item.authorization),['Bearer first-secret-fixture','Bearer second-secret-fixture']);assert(requests.every(item=>item.body.model==='provider-fixture-model'));assert.equal(metrics.attempts,2);assert(chunks.some(chunk=>chunk.includes('provider reply')));
  }finally{globalThis.fetch=oldFetch;if(previous.key===undefined)delete process.env.AI_MAX_RETRIES;else process.env.AI_MAX_RETRIES=previous.key;if(previous.model===undefined)delete process.env.AI_MODEL;else process.env.AI_MODEL=previous.model;}
});
