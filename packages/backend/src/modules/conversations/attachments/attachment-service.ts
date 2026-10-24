import {createHash} from 'node:crypto';
import {db} from '@rumiai/backend/infrastructure/database/client';
import {CHAT_STICKERS, type ChatMessageAttachment} from '@rumiai/contracts/api-types/conversations';

const MAX_MESSAGE_CONTENT = 4_000;
const attachmentSelect = {id: true, type: true, stickerId: true, mimeType: true, byteSize: true, uploadAsset: {select: {url: true}}} as const;

export class ConversationAttachmentError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ConversationAttachmentError'; }
}

function view(row: {id:string;role:string;content:string;likedAt:Date|null;imageUrl:string|null;createdAt:Date;mediaRequestHash:string|null;attachments:Array<{id:string;type:string;stickerId:string|null;mimeType:string|null;byteSize:number|null;uploadAsset:{url:string}|null}>}) {
  const attachments: ChatMessageAttachment[] = [];
  for (const item of row.attachments) {
    if (item.type === 'IMAGE' && item.uploadAsset && item.mimeType && item.byteSize) attachments.push({id: item.id, type: 'IMAGE', url: item.uploadAsset.url, mimeType: item.mimeType, byteSize: item.byteSize});
    else if (item.type === 'STICKER' && item.stickerId) attachments.push({id: item.id, type: 'STICKER', stickerId: item.stickerId});
  }
  const {mediaRequestHash: _hash, ...message} = row;
  return {...message, attachments};
}

/** Persist display-only media without invoking or charging an AI model. */
export async function createUserMediaMessage(userId: string, conversationId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConversationAttachmentError('附件数据格式不正确。', 400);
  const body = input as Record<string, unknown>;
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const requestId = typeof body.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(body.requestId) ? body.requestId : null;
  if (!requestId) throw new ConversationAttachmentError('缺少附件请求编号，请重试。', 400);
  if (content.length > MAX_MESSAGE_CONTENT) throw new ConversationAttachmentError(`消息最多 ${MAX_MESSAGE_CONTENT} 字。`, 400);
  if (!body.attachment || typeof body.attachment !== 'object' || Array.isArray(body.attachment)) throw new ConversationAttachmentError('请选择图片或表情包。', 400);
  const attachment = body.attachment as Record<string, unknown>;
  return db.$transaction(async tx => {
    const conversation = await tx.conversation.findUnique({where: {id: conversationId}, select: {userId: true}});
    if (!conversation) throw new ConversationAttachmentError('Not found', 404);
    if (conversation.userId !== userId) throw new ConversationAttachmentError('Forbidden', 403);
    let data: {type: string; uploadAssetId?: string; stickerId?: string; mimeType?: string; byteSize?: number};
    if (attachment.type === 'IMAGE') {
      if (typeof attachment.assetId !== 'string') throw new ConversationAttachmentError('图片附件无效，请重新上传。', 400);
      const asset = await tx.uploadAsset.findFirst({where: {id: attachment.assetId, ownerId: userId, siteOwned: false, owner: {deletedAt: null}}, select: {id: true, mimeType: true, byteSize: true}});
      if (!asset) throw new ConversationAttachmentError('图片不属于当前账号，请重新上传。', 403);
      if (!asset.mimeType || !asset.byteSize) throw new ConversationAttachmentError('旧图片缺少安全校验信息，请重新上传。', 400);
      if (attachment.mimeType !== asset.mimeType || attachment.byteSize !== asset.byteSize) throw new ConversationAttachmentError('图片附件元数据不匹配，请重新上传。', 400);
      data = {type: 'IMAGE', uploadAssetId: asset.id, mimeType: asset.mimeType, byteSize: asset.byteSize};
    } else if (attachment.type === 'STICKER') {
      if (typeof attachment.stickerId !== 'string' || !CHAT_STICKERS.some(item => item.id === attachment.stickerId)) throw new ConversationAttachmentError('表情包不存在或已下架。', 400);
      data = {type: 'STICKER', stickerId: attachment.stickerId};
    } else throw new ConversationAttachmentError('暂不支持该附件类型。', 400);
    const requestHash = createHash('sha256').update(JSON.stringify({content, data})).digest('hex');
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
