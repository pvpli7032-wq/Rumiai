import {db} from '@rumiai/backend/infrastructure/database/client';
import {MemoryError,MEMORY_SUMMARY_TASK} from '@rumiai/contracts/memory/types';
import {listPanelFacts} from './fact-service';
import {readMemorySettings,readMemorySummary,readSummaryCapability} from './summary-service';
async function owned(userId:string,conversationId:string){const row=await db.conversation.findFirst({where:{id:conversationId,userId},select:{characterId:true,storyRun:{select:{id:true}}}});if(!row)throw new MemoryError('会话不存在或无权访问。',404);if(row.storyRun)throw new MemoryError('故事进度请在故事存档中管理。',409);return row;}
export async function readMemoryPanel(userId:string,conversationId:string){
 const conversation=await owned(userId,conversationId),settings=await readMemorySettings(userId);
 const [summary,facts,capability,task]=await Promise.all([readMemorySummary(conversationId),listPanelFacts(userId,conversationId),readSummaryCapability(conversation.characterId),db.backgroundTask.findUnique({where:{kind_subjectId:{kind:MEMORY_SUMMARY_TASK,subjectId:conversationId}},select:{status:true,attempts:true,updatedAt:true}})]);
 const source=summary?.coveredMessageId?await db.message.findFirst({where:{id:summary.coveredMessageId,conversationId,contextIncluded:true},select:{id:true}}):null;
 return {enabled:settings.enabled,facts,summary,summaryStatus:{available:settings.enabled&&capability.available,reason:!settings.enabled?'聊天记忆尚未开启，保存的内容暂不参与回复。':capability.reason,triggerMessages:settings.summaryTriggerMessages,maxChars:settings.summaryMaxChars,task:task?{...task,updatedAt:task.updatedAt.toISOString()}:null},sources:{coveredMessageId:source?.id??null}};
}
export async function changeMemorySummary(userId:string,conversationId:string,input:unknown,remove=false){
 await owned(userId,conversationId);const settings=await readMemorySettings(userId);if(!settings.enabled)throw new MemoryError('聊天记忆尚未开启。',409);
 if(!input||typeof input!=='object'||Array.isArray(input))throw new MemoryError('摘要数据无效。');
 const value=input as Record<string,unknown>;if(!Number.isInteger(value.expectedVersion)||Number(value.expectedVersion)<0)throw new MemoryError('请提供当前摘要版本。');
 const text=typeof value.summary==='string'?value.summary.trim():'';if(!remove&&(!text||Array.from(text).length>settings.summaryMaxChars))throw new MemoryError('摘要不能为空，且最多'+settings.summaryMaxChars+'字。');
 await db.$transaction(async tx=>{
  const current=await tx.conversationMemory.findUnique({where:{conversationId}});
  if(!current||current.version!==value.expectedVersion)throw new MemoryError('摘要已经变化，请重新读取后再修改。',409,'MEMORY_VERSION_CONFLICT');
  if(current.coveredMessageId&&!await tx.message.findFirst({where:{id:current.coveredMessageId,conversationId,contextIncluded:true},select:{id:true}}))throw new MemoryError('摘要来源已失效，请重新读取。',409,'MEMORY_SOURCE_INVALID');
  const result=remove?await tx.conversationMemory.deleteMany({where:{conversationId,version:current.version}}):await tx.conversationMemory.updateMany({where:{conversationId,version:current.version},data:{summary:text,version:{increment:1}}});
  if(result.count!==1)throw new MemoryError('摘要已经变化，请重新读取。',409,'MEMORY_VERSION_CONFLICT');
 });
 return readMemoryPanel(userId,conversationId);
}
