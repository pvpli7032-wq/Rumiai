import {db} from '@rumiai/backend/infrastructure/database/client';
import {readSettingValue} from '@rumiai/backend/modules/settings/index';
import {isValidTimezone, resolveZonedDayRange} from '@rumiai/backend/infrastructure/time/zoned-day';
import {readDailyRequestRules, readChatRules} from '@rumiai/backend/modules/settings/limits';
import {readConversationForChat} from './conversation-service';
import {readTaskModelKey, readTaskModelPlan} from '@rumiai/backend/modules/ai/models/task-models';
import {readTaskBudget} from '@rumiai/backend/modules/ai/task-budget';
import {reserveAiCall, finishAiCall} from '@rumiai/backend/modules/ai/ai-usage';
import {buildMemoryContext} from '@rumiai/backend/modules/memory/context';
import {openUpstream} from './chat-stream';
import {collectStreamText} from '@rumiai/backend/modules/ai/stream-collect';
import type {AiStreamMetrics} from '@rumiai/backend/modules/ai/types';
import type {ChatSuggestionCapability, ChatSuggestionResult} from '@rumiai/contracts/conversations/suggestions';

export class ChatSuggestionError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {super(message);}
}
const bounds = async () => {const rules = await readDailyRequestRules(); const timezone = isValidTimezone(rules.timezone) ? rules.timezone : 'UTC'; const day = resolveZonedDayRange(new Date(), timezone); return {start: day.startAt, reset: day.resetAt};};
async function settings() {
  const [enabled,count,maxChars,dailyLimit,prompt,budget,modelKey] = await Promise.all([
    readSettingValue<boolean>('chat.suggestions.enabled'),readSettingValue<number>('chat.suggestions.count'),
    readSettingValue<number>('chat.suggestions.maxChars'),readSettingValue<number>('chat.suggestions.dailyLimit'),
    readSettingValue<string>('prompt.chatSuggestions'),readTaskBudget('chatSuggestions'),readTaskModelKey('chatSuggestions'),
  ]);
  return {enabled,count,maxChars,dailyLimit,prompt,budget,modelKey};
}
export async function readChatSuggestionCapability(userId: string, conversationId: string): Promise<ChatSuggestionCapability> {
  const conversation = await readConversationForChat(userId,conversationId), config = await settings(), day = await bounds();
  const used = await db.chatSuggestionRequest.count({where:{userId,createdAt:{gte:day.start}}});
  const remaining = Math.max(0,config.dailyLimit-used);
  let reason: string | null = null;
  if (conversation.storyRun) reason='故事模式请使用场景行动建议。';
  else if (!config.enabled) reason='接话建议暂未开放。';
  else if (!config.modelKey || !config.budget || config.budget<=0 || config.dailyLimit<=0) reason='接话建议待管理员配置模型、预算和使用次数。';
  else if (!remaining) reason='今天的接话建议次数已用完。';
  else {const plan=await readTaskModelPlan('chatSuggestions',{characterId:conversation.characterId}); if(!plan?.length||plan[0].key!==config.modelKey)reason='接话建议的模型当前不可用。';}
  return {available:!reason,reason,count:config.count,maxChars:config.maxChars,remaining,resetAt:day.reset.toISOString()};
}
export function parseSuggestionText(text:string,count:number,maxChars:number):string[] {
  let parsed:unknown;
  try {parsed=JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));} catch {throw new ChatSuggestionError('建议格式不正确，请换一批。',502,'SUGGESTIONS_INVALID');}
  if(!Array.isArray(parsed))throw new ChatSuggestionError('建议格式不正确，请换一批。',502,'SUGGESTIONS_INVALID');
  const result=[...new Set(parsed.filter((x):x is string=>typeof x==='string').map(x=>x.trim()).filter(x=>x&&x.length<=maxChars))].slice(0,count);
  if(!result.length)throw new ChatSuggestionError('模型没有返回可用建议，请换一批。',502,'SUGGESTIONS_EMPTY');
  return result;
}
export async function generateChatSuggestions(userId:string,conversationId:string,requestId:unknown,signal?:AbortSignal):Promise<ChatSuggestionResult>{
  if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(requestId))throw new ChatSuggestionError('建议请求编号无效。',422,'INVALID_REQUEST_ID');
  const conversation=await readConversationForChat(userId,conversationId);
  const key={userId_conversationId_requestId:{userId,conversationId,requestId}};
  const replay=await db.chatSuggestionRequest.findUnique({where:key});
  if(replay){if(replay.status==='COMPLETE')return{requestId,suggestions:JSON.parse(replay.suggestionsJson||'[]'),remaining:(await readChatSuggestionCapability(userId,conversationId)).remaining};throw new ChatSuggestionError(replay.status==='PROCESSING'?'这批建议仍在生成，请稍后重试。':'这批建议已失败，请换一批。',replay.status==='PROCESSING'?409:502,replay.status==='PROCESSING'?'SUGGESTIONS_IN_PROGRESS':'SUGGESTIONS_FAILED');}
  const capability=await readChatSuggestionCapability(userId,conversationId);
  if(!capability.available)throw new ChatSuggestionError(capability.reason||'建议暂不可用。',capability.remaining?503:429,'SUGGESTIONS_UNAVAILABLE');
  const config=await settings(),day=await bounds();
  const request=await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('UPDATE conversations SET updated_at=updated_at WHERE id=?',conversationId);
    if(await tx.chatSuggestionRequest.findUnique({where:key}))throw new ChatSuggestionError('这批建议仍在生成，请稍后重试。',409,'SUGGESTIONS_IN_PROGRESS');
    if(await tx.chatSuggestionRequest.count({where:{userId,createdAt:{gte:day.start}}})>=config.dailyLimit)throw new ChatSuggestionError('今天的建议次数已用完。',429,'SUGGESTIONS_LIMIT');
    return tx.chatSuggestionRequest.create({data:{userId,conversationId,requestId}});
  });
  let call:Awaited<ReturnType<typeof reserveAiCall>>|null=null;
  const metrics:AiStreamMetrics={};
  try {
    const plan=await readTaskModelPlan('chatSuggestions',{characterId:conversation.characterId});
    if(!plan?.length||plan[0].key!==config.modelKey)throw new ChatSuggestionError('建议模型不可用。',503,'SUGGESTIONS_NO_MODEL');
    const rules=await readChatRules();
    const rows=await db.message.findMany({where:{conversationId},orderBy:[{createdAt:'desc'},{id:'desc'}],take:rules.historyMessages,select:{role:true,content:true}});
    const memory=await buildMemoryContext(conversationId,{userId,reservedTokens:rows.reduce((n,r)=>n+r.content.length,0)});
    call=await reserveAiCall(userId,conversationId,'CHAT_SUGGESTIONS',plan.map(x=>x.key),'chatSuggestions');
    const prompt=config.prompt+'\n角色：'+conversation.character.name+'\n角色设定：'+conversation.character.personality+'\n'+(memory.text||'')+'\n请给出'+config.count+'条建议，每条最多'+config.maxChars+'字。只输出JSON字符串数组。';
    const model=plan[0];metrics.model=model.modelCode;metrics.modelKey=model.key;metrics.attempts=1;
    const response=await openUpstream(model.modelCode,prompt,rows.reverse(),'请以用户身份给出接下来可以说的话。',signal,model.provider,model);
    const suggestions=parseSuggestionText(await collectStreamText(response,metrics),config.count,config.maxChars);
    await finishAiCall(call.id,call.startedAt,'SUCCEEDED',metrics);
    await db.chatSuggestionRequest.update({where:{id:request.id},data:{status:'COMPLETE',suggestionsJson:JSON.stringify(suggestions),finishedAt:new Date()}});
    return{requestId,suggestions,remaining:(await readChatSuggestionCapability(userId,conversationId)).remaining};
  } catch(error){
    if(call)await finishAiCall(call.id,call.startedAt,'FAILED',metrics,'CHAT_SUGGESTIONS_FAILED').catch(()=>{});
    await db.chatSuggestionRequest.update({where:{id:request.id},data:{status:'FAILED',errorCode:error instanceof ChatSuggestionError?error.code:'UPSTREAM_FAILED',finishedAt:new Date()}});
    throw error;
  }
}
