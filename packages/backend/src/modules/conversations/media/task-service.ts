import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {db} from '@rumiai/backend/infrastructure/database/client';
import {readSettingValue,readUploadMaxBytes} from '@rumiai/backend/modules/settings';
import {readDailyRequestRules} from '@rumiai/backend/modules/settings/limits';
import {readTaskModelKey,readTaskModelPlan} from '@rumiai/backend/modules/ai/models/task-models';
import {readTaskBudget} from '@rumiai/backend/modules/ai/task-budget';
import {reserveAiCall,finishAiCall} from '@rumiai/backend/modules/ai/ai-usage';
import {readConversationForChat} from '../conversation-service';
import {uploadDirectory} from '@rumiai/backend/modules/uploads/storage-service';
import {resolveZonedDayRange,isValidTimezone} from '@rumiai/backend/infrastructure/time/zoned-day';
import {readWavDurationMs} from '@rumiai/backend/modules/uploads/wav';
import {type MediaOperation,type MediaCapability,type ConversationMediaCapabilities,type MediaTaskResult} from '@rumiai/contracts/conversations/media';
export class MediaTaskError extends Error{constructor(message:string,readonly status=400,readonly code='MEDIA_INVALID'){super(message);}}
const taskName=(operation:MediaOperation):'imageUnderstanding'|'audioTranscription'=>operation==='IMAGE_UNDERSTANDING'?'imageUnderstanding':'audioTranscription';
async function policy(operation:MediaOperation){const task=taskName(operation),prefix='media.'+task;const [enabled,dailyLimit,budget,modelKey,rules]=await Promise.all([readSettingValue<boolean>(prefix+'.enabled'),readSettingValue<number>(prefix+'.dailyLimit'),readTaskBudget(task),readTaskModelKey(task),readDailyRequestRules()]);const day=resolveZonedDayRange(new Date(),isValidTimezone(rules.timezone)?rules.timezone:'UTC');const maxChars=await readSettingValue<number>(operation==='IMAGE_UNDERSTANDING'?'media.imageUnderstanding.maxChars':'chat.maxMessageChars');return {task,enabled,dailyLimit,budget,modelKey,day,maxChars};}
async function capability(userId:string,conversationId:string,operation:MediaOperation):Promise<MediaCapability>{const conversation=await readConversationForChat(userId,conversationId),config=await policy(operation);const used=await db.mediaTaskRequest.count({where:{userId,operation,createdAt:{gte:config.day.startAt}}}),remaining=Math.max(0,config.dailyLimit-used);let reason:string|null=null;if(!config.enabled)reason='此媒体能力暂未开放。';else if(!config.modelKey||!config.budget||config.budget<=0||config.dailyLimit<=0)reason='需管理员配置支持的模型、正预算和使用次数。';else if(!remaining)reason='今天的媒体任务次数已用完。';else{const plan=await readTaskModelPlan(config.task,{characterId:conversation.characterId});if(!plan?.length||plan[0].key!==config.modelKey)reason='所配模型不支持此媒体能力或当前不可用。';}return {available:!reason,reason,remaining,maxChars:config.maxChars};}
export async function readConversationMediaCapabilities(userId:string,conversationId:string):Promise<ConversationMediaCapabilities>{await readConversationForChat(userId,conversationId);const [image,transcription,uploadMaxBytes,audioMaxDurationSeconds]=await Promise.all([capability(userId,conversationId,'IMAGE_UNDERSTANDING'),capability(userId,conversationId,'AUDIO_TRANSCRIPTION'),readUploadMaxBytes(),readSettingValue<number>('media.audio.maxDurationSeconds')]);return {image,transcription,uploadMaxBytes,audioMaxDurationSeconds};}
export async function executeMediaTask(userId:string,conversationId:string,operation:MediaOperation,input:unknown,signal?:AbortSignal):Promise<MediaTaskResult>{
 const conversation=await readConversationForChat(userId,conversationId),body=input as {requestId?:unknown;assetId?:unknown;question?:unknown}|null;
 if(!body||typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(body.requestId)||typeof body.assetId!=='string')throw new MediaTaskError('媒体请求或资源标识无效。',422);
 const question=typeof body.question==='string'?body.question.trim():'';const maxQuestion=await readSettingValue<number>('chat.maxMessageChars');if(question.length>maxQuestion)throw new MediaTaskError('图片问题超过当前字数限制。',422);
 const asset=await db.uploadAsset.findFirst({where:{id:body.assetId,ownerId:userId}});if(!asset)throw new MediaTaskError('资源不存在或不属于当前账号。',404);
 const allowed=operation==='IMAGE_UNDERSTANDING'?['image/jpeg','image/png','image/webp']:['audio/wav','audio/x-wav'];if(!asset.mimeType||!allowed.includes(asset.mimeType))throw new MediaTaskError('资源格式不支持此媒体任务。',415);
 if(!/^\/uploads\/[a-f0-9]+-[a-f0-9]+\.(jpg|png|webp|wav)$/.test(asset.url))throw new MediaTaskError('媒体资源路径无效。',422);
 const requestHash=createHash('sha256').update(JSON.stringify({conversationId,assetId:asset.id,question,operation})).digest('hex'),key={userId_operation_requestId:{userId,operation,requestId:body.requestId}};
 const replay=await db.mediaTaskRequest.findUnique({where:key});if(replay){if(replay.conversationId!==conversationId||replay.requestHash!==requestHash)throw new MediaTaskError('请求编号已用于其他媒体内容。',409,'REQUEST_CONFLICT');if(replay.status==='COMPLETE')return {requestId:body.requestId,status:'COMPLETE',text:replay.resultText??'',assetId:asset.id};throw new MediaTaskError(replay.status==='PROCESSING'?'该媒体任务仍在处理中，请稍后重试。':'此任务已失败，请重新发起。',replay.status==='PROCESSING'?409:502,replay.status==='PROCESSING'?'MEDIA_PROCESSING':'MEDIA_TASK_FAILED');}
 const config=await policy(operation),available=await capability(userId,conversationId,operation);if(!available.available)throw new MediaTaskError(available.reason??'媒体能力不可用。',config.enabled&&config.dailyLimit>0&&available.remaining===0?429:503);
 const bytes=await readFile(path.join(uploadDirectory(),path.basename(asset.url)));if(bytes.length!==asset.byteSize||bytes.length>await readUploadMaxBytes())throw new MediaTaskError('媒体文件大小已变化或超过限制。',413);
 if(operation==='AUDIO_TRANSCRIPTION'){let meta;try{meta=readWavDurationMs(bytes);}catch(e){throw new MediaTaskError(e instanceof Error?e.message:'录音格式错误。',415);}if(meta>await readSettingValue<number>('media.audio.maxDurationSeconds')*1000)throw new MediaTaskError('录音超过后台允许的时长。',413);}
 const request=await db.$transaction(async tx=>{await tx.$executeRawUnsafe('UPDATE users SET coins=coins WHERE id=?',userId);if(await tx.mediaTaskRequest.findUnique({where:key}))throw new MediaTaskError('任务已提交，请按原请求编号查询。',409);if(await tx.mediaTaskRequest.count({where:{userId,operation,createdAt:{gte:config.day.startAt}}})>=config.dailyLimit)throw new MediaTaskError('今日媒体任务次数已用完。',429);return tx.mediaTaskRequest.create({data:{userId,conversationId,operation,requestId:body.requestId as string,requestHash,assetId:asset.id}});});
 let call:Awaited<ReturnType<typeof reserveAiCall>>|null=null;
 try{
  const plan=await readTaskModelPlan(config.task,{characterId:conversation.characterId}),model=plan?.[0];if(!model||model.key!==config.modelKey)throw new MediaTaskError('媒体模型不可用。',503);
  call=await reserveAiCall(userId,conversationId,operation,[model.key],config.task);
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(model.timeoutMs)]):AbortSignal.timeout(model.timeoutMs);
  let response:Response;
  if(operation==='IMAGE_UNDERSTANDING'){const prompt=await readSettingValue<string>('prompt.imageUnderstanding');response=await fetch(model.provider.baseUrl.replace(/\/$/,'')+'/chat/completions',{method:'POST',redirect:'error',signal:combined,headers:{Authorization:'Bearer '+model.provider.apiKey,'Content-Type':'application/json'},body:JSON.stringify({model:model.modelCode,stream:false,max_tokens:model.maxOutputTokens,messages:[{role:'system',content:prompt+'\n最多'+config.maxChars+'字。'},{role:'user',content:[{type:'text',text:question||'请描述这张图片。'},{type:'image_url',image_url:{url:'data:'+asset.mimeType+';base64,'+bytes.toString('base64')}}]}]})});}
  else{const form=new FormData();form.set('model',model.modelCode);form.set('file',new Blob([new Uint8Array(bytes)],{type:'audio/wav'}),'recording.wav');form.set('response_format','json');response=await fetch(model.provider.baseUrl.replace(/\/$/,'')+'/audio/transcriptions',{method:'POST',redirect:'error',signal:combined,headers:{Authorization:'Bearer '+model.provider.apiKey},body:form});}
  if(!response.ok){await response.body?.cancel();throw new MediaTaskError('媒体服务暂时返回错误，请稍后重试。',502,'MEDIA_UPSTREAM_HTTP');}
  const result=await response.json();const text=(operation==='IMAGE_UNDERSTANDING'?result.choices?.[0]?.message?.content:result.text);if(typeof text!=='string'||!text.trim())throw new MediaTaskError('模型未返回可用文字，请重试。',502,'MEDIA_EMPTY');
  const output=text.trim();if(operation==='IMAGE_UNDERSTANDING'&&output.length>config.maxChars)throw new MediaTaskError('图片理解结果超过已配置长度，请缩短问题后重试。',502,'MEDIA_OUTPUT_LIMIT');
  await finishAiCall(call.id,call.startedAt,'SUCCEEDED',{model:model.modelCode,modelKey:model.key,attempts:1,inputTokens:result.usage?.prompt_tokens,outputTokens:result.usage?.completion_tokens});
  await db.mediaTaskRequest.update({where:{id:request.id},data:{status:'COMPLETE',resultText:output,finishedAt:new Date()}});
  return {requestId:body.requestId,status:'COMPLETE',text:output,assetId:asset.id};
 }catch(e){if(call)await finishAiCall(call.id,call.startedAt,'FAILED',{},e instanceof MediaTaskError?e.code:'MEDIA_UPSTREAM_FAILED').catch(()=>{});await db.mediaTaskRequest.update({where:{id:request.id},data:{status:'FAILED',errorCode:e instanceof MediaTaskError?e.code:'MEDIA_UPSTREAM_FAILED',finishedAt:new Date()}});if(e instanceof MediaTaskError)throw e;throw new MediaTaskError(signal?.aborted?'媒体操作已取消。':'媒体处理失败，请稍后重试。',502,'MEDIA_UPSTREAM_FAILED');}
}
