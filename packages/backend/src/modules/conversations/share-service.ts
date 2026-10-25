import {randomBytes, createHash} from 'node:crypto';
import {db} from '@rumiai/backend/infrastructure/database/client';
import {readSettingValue} from '@rumiai/backend/modules/settings';
import {ConversationError} from './conversation-service';
import type {SharedConversationProjection} from '@rumiai/contracts/public-api';
import type {CreateConversationShare} from '@rumiai/contracts/conversations/sharing';

const messageSelect = {id: true, role: true, content: true, createdAt: true} as const;
function digest(messages: Array<{id: string; role: string; content: string; createdAt: Date | string}>) {
  return createHash('sha256').update(JSON.stringify(messages.map(m => [m.id,m.role,m.content,new Date(m.createdAt).toISOString()]))).digest('hex');
}
async function owned(userId: string, id: string) {
  const row = await db.conversation.findFirst({where: {id,userId},select: {id:true,title:true,userId:true,character:{select:{id:true,name:true,avatarUrl:true,isPublic:true,reviewStatus:true}}}});
  if (!row) throw new ConversationError('对话不存在或不可访问。',404);
  return row;
}
export async function previewConversationShare(userId: string, conversationId: string) {
  await owned(userId,conversationId);
  const maxMessages = await readSettingValue<number>('chat.shareMaxMessages');
  const [messages,shares] = await Promise.all([
    db.message.findMany({where:{conversationId,role:{in:['USER','ASSISTANT']},content:{not:''}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:maxMessages,select:messageSelect}),
    db.conversationShare.findMany({where:{conversationId,revokedAt:null},orderBy:{createdAt:'desc'},select:{id:true,createdAt:true,messageCount:true}}),
  ]);
  return {maxMessages,messages:messages.reverse().map(m=>({...m,version:digest([m])})),shares};
}
export async function createConversationShare(userId: string, conversationId: string, input: unknown) {
  const body = input as Partial<CreateConversationShare> | null;
  const max = await readSettingValue<number>('chat.shareMaxMessages');
  if (!body || body.confirmed !== true || !Array.isArray(body.messageIds) || !body.messageIds.length || body.messageIds.length>max || body.messageIds.some(id=>typeof id!=='string') || new Set(body.messageIds).size!==body.messageIds.length || !body.messageVersions || typeof body.messageVersions!=='object' || body.messageIds.some(id=>typeof body.messageVersions?.[id]!=='string')) throw new ConversationError('请先预览并选择要公开的消息。',400);
  const ids = body.messageIds;
  return db.$transaction(async tx => {
    const row = await tx.conversation.findFirst({where:{id:conversationId,userId},select:{title:true,character:{select:{id:true,name:true,avatarUrl:true,isPublic:true,reviewStatus:true}}}});
    if (!row) throw new ConversationError('对话不存在或不可访问。',404);
    if (!row.character.isPublic || row.character.reviewStatus!=='APPROVED') throw new ConversationError('该角色未公开，不能分享对话。',409);
    const messages = await tx.message.findMany({where:{conversationId,id:{in:ids},role:{in:['USER','ASSISTANT']},content:{not:''}},orderBy:[{createdAt:'asc'},{id:'asc'}],select:messageSelect});
    if(messages.length!==ids.length || messages.some(message=>body.messageVersions?.[message.id]!==digest([message]))) throw new ConversationError('所选消息已变化，请重新预览。',409);
    const id=randomBytes(24).toString('base64url');
    const now=new Date();
    const snapshot: SharedConversationProjection={id,title:null,createdAt:now.toISOString(),character:{id:row.character.id,name:row.character.name,avatarUrl:row.character.avatarUrl},messages:messages.map(m=>({...m,createdAt:m.createdAt.toISOString()}))};
    await tx.conversationShare.create({data:{id,conversationId,snapshotJson:JSON.stringify(snapshot),sourceDigest:digest(messages),messageCount:messages.length}});
    return {id,path:'/share/chat/'+id,turnCount:messages.length};
  });
}
export async function revokeConversationShare(userId: string, conversationId: string, shareId: unknown) {
  await owned(userId,conversationId);
  if(typeof shareId!=='string'||!shareId) throw new ConversationError('请选择要撤销的分享。',400);
  const result=await db.conversationShare.updateMany({where:{id:shareId,conversationId},data:{revokedAt:new Date()}});
  if(!result.count) throw new ConversationError('分享不存在。',404);
  return {success:true};
}
export async function readPublicConversationShare(id: string): Promise<SharedConversationProjection | null> {
  const row=await db.conversationShare.findUnique({where:{id},include:{conversation:{select:{user:{select:{deletedAt:true,suspendedAt:true}},character:{select:{isPublic:true,reviewStatus:true}}}}}});
  if(!row || row.revokedAt || row.conversation.user.deletedAt || row.conversation.user.suspendedAt || !row.conversation.character.isPublic || row.conversation.character.reviewStatus!=='APPROVED') return null;
  const snapshot=JSON.parse(row.snapshotJson) as SharedConversationProjection;
  const messages=await db.message.findMany({where:{conversationId:row.conversationId,id:{in:snapshot.messages.map(m=>m.id)}},orderBy:[{createdAt:'asc'},{id:'asc'}],select:messageSelect});
  // Editing/deleting a source invalidates the public link; later private replies never join the snapshot.
  if(messages.length!==snapshot.messages.length || digest(messages)!==row.sourceDigest) return null;
  return snapshot;
}
