import {randomUUID} from 'node:crypto';
import {db} from '@rumiai/backend/infrastructure/database/client';
import {StoryError} from '../repository/contracts';
import {requireVisibleRun,requirePublishedTemplate,view,runInclude} from '../repository/run-service';
import {readState} from './state-model';

export async function listStorySaves(userId:string,runId:string,cursor?:string|null){
 return db.$transaction(async tx=>{await requireVisibleRun(tx,userId,runId);const rows=await tx.storySave.findMany({where:{userId,runId,...(cursor?{id:{lt:cursor}}:{})},orderBy:{id:'desc'},take:21,select:{id:true,title:true,createdAt:true}});return {items:rows.slice(0,20),nextCursor:rows.length>20?rows[19].id:null};});
}
export async function createStorySave(userId:string,runId:string,input:unknown){
 const body=input as {title?:unknown;expectedRevision?:unknown}|null;
 const title=typeof body?.title==='string'?body.title.trim():'';
 if(!title||title.length>80||!Number.isInteger(body?.expectedRevision))throw new StoryError('INVALID_SAVE','请填写1至80字存档名称并提供当前版本。',422);
 return db.$transaction(async tx=>{
  const run=await requireVisibleRun(tx,userId,runId);
  if(run.revision!==body!.expectedRevision)throw new StoryError('REVISION_CONFLICT','故事已有更新，请刷新后存档。',409);
  if(run.activeTurnId||run.stateProcessedThroughTurnNo!==run.lastCommittedTurnNo)throw new StoryError('STATE_PENDING','请等待当前回合及状态整理结束后存档。',409);
  if(!readState(run.stateJson))throw new StoryError('INVALID_STORY_DATA','故事状态不完整，不能存档。',422);
  const turns=await tx.storyTurn.findMany({where:{runId,status:'COMMITTED',stateStatus:'PROCESSED'},orderBy:{turnNo:'asc'}});
  const ids=turns.flatMap(turn=>[turn.inputMessageId,turn.assistantMessageId]).filter((id):id is string=>Boolean(id));
  const messages=await tx.message.findMany({where:{conversationId:run.conversationId,id:{in:ids}},orderBy:[{createdAt:'asc'},{id:'asc'}],select:{id:true,role:true,content:true,createdAt:true}});
  if(messages.length!==new Set(ids).size)throw new StoryError('INVALID_STORY_DATA','故事消息不完整，不能存档。',422);
  const events=await tx.storyEvent.findMany({where:{runId,status:'CONFIRMED',invalidatedAt:null,sourceTurnId:{in:turns.map(turn=>turn.id)}},orderBy:{createdAt:'asc'}});
  const checkpoints=await tx.storyCheckpoint.findMany({where:{runId,invalidatedAt:null,throughTurnNo:{lte:run.lastCommittedTurnNo}},orderBy:[{throughTurnNo:'asc'},{revision:'asc'}],select:{throughTurnNo:true,revision:true,stateJson:true}});
  const snapshot={schemaVersion:1,revision:run.revision,checkpoints,relationshipStatus:run.conversation.relationshipStatus,romance:run.conversation.romance,intimacy:run.conversation.intimacy,templateVersionId:run.templateVersionId,chapterKey:run.chapterKey,status:run.status,stateJson:run.stateJson,lastCommittedTurnNo:run.lastCommittedTurnNo,startedAt:run.startedAt,endedAt:run.endedAt,characterId:run.conversation.characterId,title:run.conversation.title,turns:turns.map(turn=>({id:turn.id,turnNo:turn.turnNo,requestId:turn.requestId,requestHash:turn.requestHash,operation:turn.operation,inputMessageId:turn.inputMessageId,assistantMessageId:turn.assistantMessageId,startedAt:turn.startedAt,committedAt:turn.committedAt})),messages,events:events.map(event=>({sourceTurnId:event.sourceTurnId,sourceMessageId:event.sourceMessageId,chapterKey:event.chapterKey,type:event.type,payloadJson:event.payloadJson,createdAt:event.createdAt}))};
  const row=await tx.storySave.create({data:{userId,runId,title,snapshotJson:JSON.stringify(snapshot)}});
  return {id:row.id,title:row.title,createdAt:row.createdAt};
 });
}
export async function deleteStorySave(userId:string,runId:string,saveId:string){
 return db.$transaction(async tx=>{await requireVisibleRun(tx,userId,runId);const deleted=await tx.storySave.deleteMany({where:{id:saveId,userId,runId}});if(!deleted.count)throw new StoryError('SAVE_NOT_FOUND','存档不存在。',404);return {success:true};});
}
export async function restoreStorySave(userId:string,runId:string,saveId:string,input:unknown){
 const requestId=(input as {requestId?:unknown}|null)?.requestId;
 if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(requestId))throw new StoryError('INVALID_REQUEST','缺少有效恢复请求编号。',422);
 return db.$transaction(async tx=>{
  const source=await requireVisibleRun(tx,userId,runId);requirePublishedTemplate(source);
  const replay=await tx.storyRun.findUnique({where:{userId_createRequestId:{userId,createRequestId:requestId}}});
  if(replay){if(replay.restoredFromSaveId!==saveId)throw new StoryError('REQUEST_CONFLICT','请求编号已用于其他存档。',409);return {run:await view(tx,await requireVisibleRun(tx,userId,replay.id)),created:false};}
  const save=await tx.storySave.findFirst({where:{id:saveId,userId,runId}});if(!save)throw new StoryError('SAVE_NOT_FOUND','存档不存在。',404);
  const data=JSON.parse(save.snapshotJson);
  if(data.schemaVersion!==1||data.templateVersionId!==source.templateVersionId||!readState(data.stateJson)||!Array.isArray(data.messages)||!Array.isArray(data.turns)||!Array.isArray(data.events))throw new StoryError('INVALID_STORY_DATA','存档数据不完整。',422);
  const conversation=await tx.conversation.create({data:{userId,characterId:data.characterId,title:data.title,relationshipStatus:data.relationshipStatus??null,romance:data.romance??0,intimacy:data.intimacy??0}});
  const run=await tx.storyRun.create({data:{userId,conversationId:conversation.id,templateVersionId:data.templateVersionId,chapterKey:data.chapterKey,status:data.status,revision:data.revision,stateJson:data.stateJson,lastCommittedTurnNo:data.lastCommittedTurnNo,stateProcessedThroughTurnNo:data.lastCommittedTurnNo,createRequestId:requestId,parentRunId:runId,restoredFromSaveId:saveId,startedAt:new Date(),endedAt:data.endedAt?new Date(data.endedAt):null}});
  const messageIds=new Map<string,string>();let messageIndex=0;
  for(const message of data.messages){const id='restored-'+String(messageIndex++).padStart(8,'0')+'-'+randomUUID();messageIds.set(message.id,id);await tx.message.create({data:{id,conversationId:conversation.id,role:message.role,content:message.content,createdAt:new Date(message.createdAt)}});}
  const turnIds=new Map<string,string>();
  for(const turn of data.turns){const id=randomUUID();turnIds.set(turn.id,id);await tx.storyTurn.create({data:{id,runId:run.id,turnNo:turn.turnNo,requestId:turn.requestId,requestHash:turn.requestHash,status:'COMMITTED',stateStatus:'PROCESSED',operation:turn.operation,inputMessageId:turn.inputMessageId?messageIds.get(turn.inputMessageId):null,assistantMessageId:turn.assistantMessageId?messageIds.get(turn.assistantMessageId):null,startedAt:new Date(turn.startedAt),committedAt:turn.committedAt?new Date(turn.committedAt):null}});}
  for(const event of data.events){const sourceTurnId=turnIds.get(event.sourceTurnId);if(!sourceTurnId)throw new StoryError('INVALID_STORY_DATA','存档事件来源缺失。',422);await tx.storyEvent.create({data:{runId:run.id,sourceTurnId,sourceMessageId:event.sourceMessageId?messageIds.get(event.sourceMessageId):null,chapterKey:event.chapterKey,type:event.type,status:'CONFIRMED',payloadJson:event.payloadJson,createdAt:new Date(event.createdAt)}});}
  for(const checkpoint of data.checkpoints??[]){if(!readState(checkpoint.stateJson))throw new StoryError('INVALID_STORY_DATA','存档检查点不完整。',422);await tx.storyCheckpoint.create({data:{runId:run.id,throughTurnNo:checkpoint.throughTurnNo,revision:checkpoint.revision,stateJson:checkpoint.stateJson}});}
  if(!(data.checkpoints??[]).some((checkpoint:{throughTurnNo:number;revision:number})=>checkpoint.throughTurnNo===data.lastCommittedTurnNo&&checkpoint.revision===data.revision))await tx.storyCheckpoint.create({data:{runId:run.id,throughTurnNo:data.lastCommittedTurnNo,revision:data.revision,stateJson:data.stateJson}});
  await tx.character.update({where:{id:data.characterId},data:{chatCount:{increment:1}}});
  // Original fees, membership usage and published shares are deliberately not copied.
  const restored=await tx.storyRun.findUniqueOrThrow({where:{id:run.id},include:runInclude});
  return {run:await view(tx,restored),created:true};
 },{timeout:30000});
}
