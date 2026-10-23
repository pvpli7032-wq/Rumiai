/**
 * Chat streaming: prompt construction, the model fallback chain, and the SSE wire format.
 *
 * This lives in a lib rather than inside the messages route because regenerating a reply
 * needs exactly the same behaviour. Everything the route relied on is re-exported, and
 * `scripts/verify-ai-context.mjs` checks the prompt that actually reaches the model, so a
 * regression in this file fails that script rather than passing silently.
 */
import { logWarning } from '@rumiai/backend/infrastructure/logging/logger';
import { readAiInteger } from '@rumiai/backend/modules/ai/config';
import { allowedModels } from '@rumiai/backend/modules/ai/ai-models';
import type { AiStreamMetrics } from '@rumiai/backend/modules/ai/types';
import type {RuntimeAiModel} from '@rumiai/backend/modules/ai/models/runtime-service';

export type RuntimeProvider={id:string;name:string;baseUrl:string;apiKey:string};

/**
 * What a character says when every model in the chain has failed.
 *
 * These used to be seven chirpy assistant lines — "你好！很高兴和你聊天~ 😊" —
 * served regardless of who the character was, which broke the role completely at exactly
 * the moment the reader was most likely to notice. They are now written as stage direction
 * around the character's own name, holding the scene without claiming to know anything
 * about it, and they carry no emoji or assistant voice.
 *
 * A beat where a character goes quiet reads as a character going quiet. A cheerful stranger
 * introducing themselves does not.
 */
const MOCK_BEATS = [
(name:string)=>`*${name}安静地看着你，稍稍思考了一会儿。*\n\n"接下来你想聊什么？"`,
(name:string)=>`*${name}轻轻点头，等你继续说下去。*\n\n"我在听。"`,
];

export class AiStreamError extends Error {
  constructor(public code:string,public status?:number){super(code);this.name='AiStreamError';}
}
export function aiErrorCode(error:unknown):string {
  return error instanceof AiStreamError ? error.code : error instanceof Error && error.name==='AbortError' ? 'CANCELLED' : 'UPSTREAM_ERROR';
}
export function aiUserError(error:unknown):string {
 const code=aiErrorCode(error);
 return code==='REQUEST_TIMEOUT'||code==='IDLE_TIMEOUT'||code==='CONNECT_TIMEOUT'?'AI 回复超时，请稍后重试。':code==='STREAM_INCOMPLETE'?'AI 连接中断，未保存不完整回复，请重试。':'AI 服务暂时不可用，请稍后重试。';
}

/** The in-character fallback line, exported so a test can assert it holds the role. */
export function mockBeat(name: string): string {
  return MOCK_BEATS[Math.floor(Math.random() * MOCK_BEATS.length)](name);
}

/**
 * Story turns reuse the same generators but need their own SSE envelope
 * (delta{turnId,content}); `mapEvent` rewrites the wire events without
 * duplicating the model chain. The default (no mapEvent) is the chat protocol.
 */
export interface StreamWireOptions {
  mapEvent?: (event: Record<string, unknown>) => Record<string, unknown>;
  context?: string;
}

const ENCODER = new TextEncoder();

/** Write one already-mapped event in the SSE wire format; the frame was written out by hand three times. */
function sendEvent(controller: ReadableStreamDefaultController, event: Record<string, unknown>) {
  controller.enqueue(ENCODER.encode(`data: ${JSON.stringify(event)}\n\n`));
}

export async function streamMockResponse(controller: ReadableStreamDefaultController, character: { name: string; personality: string }, userMessage: string, signal?:AbortSignal, options: StreamWireOptions = {}): Promise<string> {
  const fullResponse = '【模拟 AI 回复，仅供测试】\n\n' + mockBeat(character.name);
  // Clients MUST be able to distinguish demo output from real model content.
  sendEvent(controller, options.mapEvent ? options.mapEvent({demo: true}) : {demo: true});

  // Stream word by word
  const words = fullResponse.split(' ');
  for (const word of words) {
    signal?.throwIfAborted();
    sendEvent(controller, options.mapEvent ? options.mapEvent({content: word + ' '}) : {content: word + ' '});
    await new Promise(r => setTimeout(r, 80));
  }
  return fullResponse;
}

/**
 * Models to try, in order. Daily token quotas are per provider, so when the
 * primary provider is exhausted the next entry — deliberately a different
 * provider — keeps real AI replies flowing instead of dropping every user to the
 * an error. Provider failures never switch a real request to simulated content.
 */
export function modelChain(preferred?: string | null): string[] {
  const chain = allowedModels();
  // A chat's chosen model goes first but keeps the rest of the chain behind it, so
  // picking a model never means losing the fallbacks when its quota runs out. The
  // value was validated against the same list when it was set.
  if (preferred && chain.includes(preferred)) {
    return [preferred, ...chain.filter(m => m !== preferred)];
  }
  return chain;
}

/**
 * Start an upstream completion, throwing unless it is a usable stream. Opening is
 * kept separate from reading so a quota rejection — which arrives as JSON before
 * any token — can be retried on another model without the client having seen
 * half an answer.
 */
export async function openUpstream(
  model: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  userMessage: string,
  signal?:AbortSignal,
  provider?:RuntimeProvider,
  modelConfig?:Pick<RuntimeAiModel,'timeoutMs'|'maxOutputTokens'>
): Promise<Response & { body: ReadableStream<Uint8Array> }> {
  const apiKey = provider?.apiKey ?? process.env.OPENAI_API_KEY;
  const baseUrl = provider?.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const maxTokens = modelConfig?.maxOutputTokens ?? (Number(process.env.AI_MAX_TOKENS) || 800);

  const connect = new AbortController();
  const timer=setTimeout(()=>connect.abort(new AiStreamError('CONNECT_TIMEOUT')),modelConfig?.timeoutMs??readAiInteger('AI_CONNECT_TIMEOUT_MS',10000,100,120000));
  let response:Response;
  try { response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal:signal ? AbortSignal.any([signal,connect.signal]) : connect.signal,
    redirect:'error',headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        // Already limited to the configured history count by the caller; slicing
        // again here used to throw away half of the context that was fetched.
        ...messages.map(m => ({ role: m.role.toLowerCase() === 'user' ? 'user' : 'assistant', content: m.content })),
        { role: 'user', content: userMessage },
      ],
    }),
  }); } catch(error){
    if(signal?.aborted)throw signal.reason;
    if(connect.signal.aborted)throw connect.signal.reason;
    throw new AiStreamError('UPSTREAM_NETWORK');
  } finally {clearTimeout(timer);}

  // Upstream errors (bad key, unknown model, exhausted quota) return JSON, not a
  // stream, so surface them as failures rather than streaming an empty reply.
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(()=>{});
    // Provider error bodies can echo prompt text or credentials; do not log them.
    throw new AiStreamError('UPSTREAM_HTTP_'+response.status,response.status);
  }
  return response as Response & { body: ReadableStream<Uint8Array> };
}

export interface PromptCharacter {
  name: string;
  personality: string;
  background?: string | null;
  /** The setup the reader is shown on the detail dialog — "场景". */
  scenario?: string | null;
  /** How the character is meant to be played, e.g. a narrator vs. a single persona. */
  roleTemplate?: string | null;
  /** Marked 18+ by its creator. Adult characters are written for adult readers. */
  isAdult?: boolean;
}

/**
 * How the character is told to hold its role.
 *
 * The old prompt was two lines and asked for almost nothing, which is why replies read as
 * an assistant being helpful rather than a character being itself: nothing told the model
 * to stay in scene, to write in the app's `*narration*` / "dialogue" style, or to stop
 * appending advice and reassurance the scene never asked for.
 */
const ROLEPLAY_DIRECTION = [
'你正在进行虚构角色扮演，保持角色一致，按角色设定回应。',
'界面已经告知用户这是 AI 角色；不得声称自己是真人。用户询问身份时应诚实说明。',
'不要替用户说话或决定行动，给用户留下继续故事的空间。',
'采用小说格式：动作和环境用 *星号* 标记，对话用双引号。',
'通常用 2—5 句话简洁回复，保留角色自己的情绪和观点。',
'默认使用自然的简体中文，按角色性格选择语气；用户明确要求其他语言时遵从。',
].join('\n');

/**
 * Extra latitude for a character its creator marked 18+, so an adult character is not
 * artificially coy with an adult reader — that is what the flag is for.
 *
 * The hard limits stay in place and are stated explicitly rather than left implicit: the
 * moderation taxonomy in src/lib/community/report-types.ts exists because these cases are real, and the
 * upstream provider enforces its own policy regardless of what we ask for here.
 */
const ADULT_DIRECTION = ['该角色标记为成人内容（18+）。遵守模型服务方的内容规则。','禁止涉及未成年人的性内容；不得冒充真实人物；不得美化未经同意的侵害。'].join('\n');

/**
 * The system prompt.
 *
 * scenario and roleTemplate used to be missing: 28 characters have them filled in and the
 * detail dialog shows the scenario to the reader, so the reader could see a setup the
 * character itself had never been told about.
 *
 * Empty parts are dropped rather than interpolated, because a null background used to put
 * the literal text "null" into the prompt.
 */
export function buildSystemPrompt(character: PromptCharacter): string {
  const identity = [
    `你是 ${character.name}`.trim(),
    character.personality?.trim() ? `性格：${character.personality.trim()}` : null,
    character.background?.trim() ? `背景：${character.background.trim()}` : null,
    character.scenario?.trim() ? `当前场景：${character.scenario.trim()}` : null,
    character.roleTemplate?.trim() ? `角色指引：${character.roleTemplate.trim()}` : null,
  ].filter((part): part is string => Boolean(part));

  const sections = [identity.join('\n'), ROLEPLAY_DIRECTION];
  if (character.isAdult) sections.push(ADULT_DIRECTION);

  return sections.join('\n\n');
}

export async function streamOpenAIResponse(
  controller: ReadableStreamDefaultController,
  character: PromptCharacter,
  messages: Array<{ role: string; content: string }>,
  userMessage: string,
  preferredModel?: string | null,
  options:{signal?:AbortSignal;onMetrics?:(metrics:AiStreamMetrics)=>void;providers?:RuntimeProvider[];models?:RuntimeAiModel[];mapEvent?:(event:Record<string, unknown>)=>Record<string, unknown>;context?:string}={}
): Promise<string> {
  const deadline=new AbortController();
  const timer=setTimeout(()=>deadline.abort(new AiStreamError('REQUEST_TIMEOUT')),readAiInteger('AI_REQUEST_TIMEOUT_MS',60000,100,300000));
  const signal=options.signal?AbortSignal.any([deadline.signal,options.signal]):deadline.signal;
  const metrics:AiStreamMetrics={attempts:0};
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  let fullContent='';
  try{
    signal.throwIfAborted();
    let response:(Response & {body:ReadableStream<Uint8Array>})|undefined;
    const retries=readAiInteger('AI_MAX_RETRIES',1,0,2);
    let lastError:unknown=new AiStreamError('UPSTREAM_ERROR');
    const configured=options.providers??[];
    const providers=configured.length?[
      ...configured,
      ...(process.env.OPENAI_API_KEY?.trim()?[{id:'environment',name:'环境配置',baseUrl:process.env.OPENAI_BASE_URL||'https://api.openai.com/v1',apiKey:process.env.OPENAI_API_KEY}]:[]),
    ]:[{id:'environment',name:'环境配置',baseUrl:process.env.OPENAI_BASE_URL||'https://api.openai.com/v1',apiKey:process.env.OPENAI_API_KEY||''}];
    const candidates=options.models?.length?options.models.map(model=>({model:model.modelCode,provider:model.provider,config:model,retries:model.maxRetries})):modelChain(preferredModel).flatMap(model=>providers.map(provider=>({model,provider,config:undefined,retries})));
    for(const candidate of candidates){
      for(let attempt=0;attempt<=candidate.retries;attempt++){
        signal.throwIfAborted();metrics.model=candidate.model;metrics.modelKey=candidate.config?.key;metrics.attempts=(metrics.attempts||0)+1;
        try{const basePrompt=buildSystemPrompt(character);const systemPrompt=options.context?basePrompt+'\n\n'+options.context:basePrompt;response=await openUpstream(candidate.model,systemPrompt,messages,userMessage,signal,candidate.provider,candidate.config);break;}
        catch(error){
          if(signal.aborted)throw signal.reason;
          lastError=error;
          const status=error instanceof AiStreamError?error.status:undefined;
          const transient=status===429||(status!==undefined&&status>=500)||aiErrorCode(error)==='UPSTREAM_NETWORK'||aiErrorCode(error)==='CONNECT_TIMEOUT';
          if(!transient||attempt===candidate.retries)break;
          // Only retry before any reply is exposed; never replay a partial answer.
          await new Promise(resolve=>setTimeout(resolve,100));
        }
      }
      if(response)break;
    }
    if(!response)throw lastError;
    reader=response.body.getReader();const decoder=new TextDecoder();let buffer='',ended=false,finished=false;
    const processLine=(line:string)=>{
      if(!line.trim().startsWith('data:'))return;
      const data=line.trim().slice(5).trim();if(data==='[DONE]'){ended=true;return;}
      let parsed:any;try{parsed=JSON.parse(data);}catch{return;}
      if(parsed.error)throw new AiStreamError('UPSTREAM_STREAM_ERROR');
      if(parsed.usage){
        const input=parsed.usage.prompt_tokens,output=parsed.usage.completion_tokens;
        if(Number.isInteger(input)&&input>=0&&input<=2147483647)metrics.inputTokens=input;
        if(Number.isInteger(output)&&output>=0&&output<=2147483647)metrics.outputTokens=output;
      }
      const choice=parsed.choices?.[0];if(choice?.finish_reason)finished=true;
      const content=choice?.delta?.content;
      if(typeof content==='string'&&content){const payload=options.mapEvent?options.mapEvent({content}):{content};fullContent+=content;sendEvent(controller,payload);}
    };
    while(!ended){
      signal.throwIfAborted();
      const idle=setTimeout(()=>deadline.abort(new AiStreamError('IDLE_TIMEOUT')),readAiInteger('AI_STREAM_IDLE_TIMEOUT_MS',15000,100,120000));
      let chunk:ReadableStreamReadResult<Uint8Array>;
      try{chunk=await reader.read();}finally{clearTimeout(idle);}
      signal.throwIfAborted();
      if(chunk.done){buffer+=decoder.decode();if(buffer.trim())processLine(buffer);break;}
      buffer+=decoder.decode(chunk.value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()||'';
      for(const line of lines){processLine(line);if(ended)break;}
    }
    if(!ended&&!finished)throw new AiStreamError('STREAM_INCOMPLETE');
    if(!fullContent.trim())throw new AiStreamError('EMPTY_RESPONSE');
    return fullContent;
  }catch(error){
    logWarning('ai_stream_failed',{code:signal.aborted?aiErrorCode(signal.reason):aiErrorCode(error),model:metrics.model,attempts:metrics.attempts,charactersDelivered:fullContent.length});
    if(signal.aborted)throw signal.reason;throw error;
  }finally{
    clearTimeout(timer);if(reader)await reader.cancel().catch(()=>{});
    options.onMetrics?.(metrics);
  }
}
