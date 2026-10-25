import {createHash} from 'node:crypto';
import {db} from '@rumiai/backend/infrastructure/database/client';

import {readChatRules} from '@rumiai/backend/modules/settings/limits';
import {attachmentSelect,messageView} from './view';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {uploadDirectory} from '@rumiai/backend/modules/uploads/storage-service';
import {readWavDurationMs} from '@rumiai/backend/modules/uploads/wav';

export class ConversationAttachmentError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ConversationAttachmentError'; }
}

function view<T extends Parameters<typeof messageView>[0]&{mediaRequestHash:string|null}>(row:T){const {mediaRequestHash:_hash,...message}=row;return messageView(message);}

/** Persist display-only media without invoking or charging an AI model. */
export async function createUserMediaMessage(userId: string, conversationId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConversationAttachmentError('附件数据格式不正确。', 400);
  const body = input as Record<string, unknown>;
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const requestId = typeof body.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(body.requestId) ? body.requestId : null;
  if (!requestId) throw new ConversationAttachmentError('缺少附件请求编号，请重试。', 400);
  const MAX_MESSAGE_CONTENT=(await readChatRules()).maxMessageChars;
  if (content.length > MAX_MESSAGE_CONTENT) throw new ConversationAttachmentError(`消息最多 ${MAX_MESSAGE_CONTENT} 字。`, 400);
  if (!body.attachment || typeof body.attachment !== 'object' || Array.isArray(body.attachment)) throw new ConversationAttachmentError('请选择图片或表情包。', 400);
  const attachment = body.attachment as Record<string, unknown>;
  return db.$transaction(async tx => {
    const conversation = await tx.conversation.findUnique({where: {id: conversationId}, select: {userId: true}});
    if (!conversation) throw new ConversationAttachmentError('Not found', 404);
    if (conversation.userId !== userId) throw new ConversationAttachmentError('Forbidden', 403);
    const existing=await tx.message.findUnique({where:{conversationId_mediaRequestId:{conversationId,mediaRequestId:requestId}},select:{id:true,role:true,content:true,likedAt:true,imageUrl:true,mediaRequestHash:true,createdAt:true,attachments:{select:attachmentSelect}}});
    if(existing){const saved=existing.attachments[0];const same=saved&&existing.content===content&&saved.type===attachment.type&&(saved.type==='STICKER'?saved.stickerId===attachment.stickerId:saved.uploadAsset?.id===attachment.assetId&&saved.mimeType===attachment.mimeType&&saved.byteSize===attachment.byteSize);if(!same)throw new ConversationAttachmentError('该请求编号已用于其他内容。',409);return view(existing);}
    let data: {type: string; uploadAssetId?: string; stickerId?: string; stickerSnapshotJson?:string; durationMs?:number; mimeType?: string; byteSize?: number};
    if (attachment.type === 'IMAGE' || attachment.type === 'AUDIO') {
      if (typeof attachment.assetId !== 'string') throw new ConversationAttachmentError('图片附件无效，请重新上传。', 400);
      const asset = await tx.uploadAsset.findFirst({where: {id: attachment.assetId, ownerId: userId, siteOwned: false, owner: {deletedAt: null}}, select: {id: true, url:true, mimeType: true, byteSize: true}});
      if (!asset) throw new ConversationAttachmentError('图片不属于当前账号，请重新上传。', 403);
      if (!asset.mimeType || !asset.byteSize) throw new ConversationAttachmentError('旧图片缺少安全校验信息，请重新上传。', 400);
      if (attachment.mimeType !== asset.mimeType || attachment.byteSize !== asset.byteSize) throw new ConversationAttachmentError('图片附件元数据不匹配，请重新上传。', 400);
      if(attachment.type==='IMAGE'&&!['image/jpeg','image/png','image/webp'].includes(asset.mimeType)||attachment.type==='AUDIO'&&asset.mimeType!=='audio/wav')throw new ConversationAttachmentError('附件类型不匹配。',400);
      const durationMs=attachment.type==='AUDIO'?readWavDurationMs(await readFile(path.join(uploadDirectory(),path.basename(asset.url)))):undefined;
      data = {type: attachment.type, uploadAssetId: asset.id, mimeType: asset.mimeType, byteSize: asset.byteSize,...(durationMs?{durationMs}:{})};
    } else if (attachment.type === 'STICKER') {
      const sticker=typeof attachment.stickerId==='string'?await tx.chatSticker.findFirst({where:{id:attachment.stickerId,isActive:true}}):null;
      if (!sticker) throw new ConversationAttachmentError('表情包不存在或已下架。', 400);
      data = {type: 'STICKER', stickerId: sticker.id,stickerSnapshotJson:JSON.stringify({label:sticker.label,glyph:sticker.glyph})};
    } else throw new ConversationAttachmentError('暂不支持该附件类型。', 400);
    const requestHash = createHash('sha256').update(JSON.stringify({content, data:{...data,stickerSnapshotJson:undefined}})).digest('hex');
    const replay = await tx.message.findUnique({where: {conversationId_mediaRequestId: {conversationId, mediaRequestId: requestId}}, select: {id: true, role: true, content: true, likedAt: true, imageUrl: true, mediaRequestHash: true, createdAt: true, attachments: {select: attachmentSelect}}});
    if (replay) {
      if (replay.mediaRequestHash !== requestHash) throw new ConversationAttachmentError('该附件请求编号已用于其他内容，请重新发送。', 409);
      return view(replay);
    }
    const message = await tx.message.upsert({where: {conversationId_mediaRequestId: {conversationId, mediaRequestId: requestId}}, create: {conversationId, role: 'USER', content, mediaRequestId: requestId, mediaRequestHash: requestHash, attachments: {create: data}}, update: {}, select: {id: true, role: true, content: true, likedAt: true, imageUrl: true, mediaRequestHash: true, createdAt: true, attachments: {select: attachmentSelect}}});
    if (message.mediaRequestHash !== requestHash) throw new ConversationAttachmentError('该附件请求编号已用于其他内容，请重新发送。', 409);
    await tx.conversation.update({where: {id: conversationId}, data: {updatedAt: new Date()}});
    return view(message);
  });
}
