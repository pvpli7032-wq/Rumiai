import { db } from '@/lib/db';
import { readAiModelCatalog } from '@/lib/ai/models/runtime-service';

const CONVERSATION_SELECT = {
  id: true, title: true, characterId: true, relationshipStatus: true, romance: true, intimacy: true,
  notes: true, archivedAt: true, relationshipMode: true, aiModel: true, createdAt: true, updatedAt: true,
} as const;

export class ConversationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ConversationError';
  }
}

const MAX_METER = 1_000_000;
const MAX_NOTES = 10_000;
function meter(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(MAX_METER, Math.max(0, Math.round(value)));
}

export async function listUserConversations(userId: string, options: {archived?: boolean; characterId?: string | null} = {}) {
  const conversations = await db.conversation.findMany({
    where: {
      userId,
      ...(options.characterId ? {characterId: options.characterId} : {}),
      ...(options.archived ? {archivedAt: {not: null}} : {archivedAt: null}),
    },
    orderBy: {updatedAt: 'desc'},
    take: 200,
    select: {
      ...CONVERSATION_SELECT,
      character: {select: {id: true, name: true, avatarUrl: true, isPublic: true, reviewStatus: true, creatorId: true}},
      _count: {select: {messages: true}},
    },
  });
  return conversations.map(({_count, character, ...conversation}) => {
    const visible = character.creatorId === userId || character.isPublic && character.reviewStatus === 'APPROVED';
    return {
      ...conversation,
      messageCount: _count.messages,
      character: {id: character.id, name: visible ? character.name : '暂不可用的角色', avatarUrl: visible ? character.avatarUrl : null},
    };
  });
}

export async function createOrReuseConversation(userId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConversationError('会话数据格式不正确。', 400);
  const body = input as Record<string, unknown>;
  const rawCharacterId = body.characterId || body.character_id;
  if (typeof rawCharacterId !== 'string' || !rawCharacterId) throw new ConversationError('characterId is required', 400);
  const characterId = rawCharacterId;
  const startNew = (body.newChat ?? body.new_chat) === true;

  return db.$transaction(async tx => {
    const character = await tx.character.findUnique({
      where: {id: characterId},
      select: {id: true, name: true, isPublic: true, reviewStatus: true, creatorId: true, relationshipStatus: true, initialRomance: true, initialIntimacy: true},
    });
    if (!character) throw new ConversationError('Character not found', 404);
    if ((!character.isPublic || character.reviewStatus !== 'APPROVED') && character.creatorId !== userId) {
      throw new ConversationError('Private character access forbidden', 403);
    }

    if (!startNew) {
      const existing = await tx.conversation.findFirst({
        where: {userId, characterId, archivedAt: null, storyRun: {is: null}},
        orderBy: {updatedAt: 'desc'},
        select: CONVERSATION_SELECT,
      });
      if (existing) return {conversation: existing};
    }

    const conversation = await tx.conversation.create({
      data: {
        userId, characterId, title: `与 ${character.name} 的对话`,
        relationshipStatus: character.relationshipStatus,
        romance: character.initialRomance,
        intimacy: character.initialIntimacy,
      },
      select: CONVERSATION_SELECT,
    });
    await tx.character.update({where: {id: characterId}, data: {chatCount: {increment: 1}}});
    return {conversation};
  });
}

export async function readConversation(userId: string, conversationId: string) {
  const conversation = await db.conversation.findUnique({
    where: {id: conversationId},
    select: {
      id: true, userId: true, title: true, relationshipStatus: true, romance: true, intimacy: true, notes: true,
      archivedAt: true, relationshipMode: true, aiModel: true, createdAt: true, updatedAt: true,
      character: {select: {id: true, name: true, tagline: true, avatarUrl: true, roleTemplate: true, scenario: true, isPublic: true, reviewStatus: true, creatorId: true}},
      _count: {select: {messages: true}},
    },
  });
  if (!conversation) throw new ConversationError('Not found', 404);
  if (conversation.userId !== userId) throw new ConversationError('Forbidden', 403);
  if ((!conversation.character.isPublic || conversation.character.reviewStatus !== 'APPROVED') && conversation.character.creatorId !== userId) {
    throw new ConversationError('角色已下架或设为私有，无法继续对话。', 403);
  }
  const {_count, userId: _ownerId, ...rest} = conversation;
  return {conversation: {...rest, messageCount: _count.messages, daysChatting: Math.max(0, Math.floor((Date.now() - rest.createdAt.getTime()) / 86_400_000))}};
}

/** Export owned history even if the role was withdrawn; never disclose its private persona. */
export async function readConversationExport(userId: string, conversationId: string) {
  const conversation = await db.conversation.findUnique({
    where: {id: conversationId},
    select: {
      id: true, userId: true, title: true, notes: true, createdAt: true, updatedAt: true, archivedAt: true,
      character: {select: {id: true, name: true, isPublic: true, reviewStatus: true, creatorId: true}},
      messages: {orderBy: [{createdAt: 'asc'}, {id: 'asc'}], select: {id: true, role: true, content: true, imageUrl: true, createdAt: true}},
    },
  });
  if (!conversation) throw new ConversationError('对话不存在。', 404);
  if (conversation.userId !== userId) throw new ConversationError('只能导出自己的对话。', 403);
  const {userId: _ownerId, messages, character, ...metadata} = conversation;
  const visible = character.creatorId === userId || character.isPublic && character.reviewStatus === 'APPROVED';
  return {
    conversation: {...metadata, character: {id: character.id, name: visible ? character.name : '暂不可用的角色'}},
    messages,
  };
}

export async function readConversationForChat(userId: string, conversationId: string) {
  const conversation = await db.conversation.findUnique({where: {id: conversationId}, include: {character: true, storyRun: {select: {id: true}}}});
  if (!conversation) throw new ConversationError('Not found', 404);
  if (conversation.userId !== userId) throw new ConversationError('Forbidden', 403);
  if ((!conversation.character.isPublic || conversation.character.reviewStatus !== 'APPROVED') && conversation.character.creatorId !== userId) {
    throw new ConversationError('角色已下架或设为私有，无法继续对话。', 403);
  }
  return conversation;
}

export async function updateConversation(userId: string, conversationId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConversationError('会话数据格式不正确。', 400);
  const body = input as Record<string, unknown>;
  const notes = typeof body.notes === 'string' ? body.notes : undefined;
  if (notes !== undefined && notes.length > MAX_NOTES) throw new ConversationError(`Notes must be ${MAX_NOTES} characters or fewer`, 400);
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined;
  const relationshipStatus = typeof body.relationshipStatus === 'string' ? body.relationshipStatus : undefined;
  const romance = meter(body.romance);
  const intimacy = meter(body.intimacy);
  const archived = typeof body.archived === 'boolean' ? body.archived : undefined;
  const rawRelationshipMode = body.relationshipMode ?? body.relationship_mode;
  const relationshipMode = typeof rawRelationshipMode === 'boolean' ? rawRelationshipMode : undefined;

  const requestedModel = Object.hasOwn(body,'aiModel') ? body.aiModel : body.ai_model;

  return db.$transaction(async tx => {
    const owned = await tx.conversation.findUnique({where: {id: conversationId}, select: {userId: true,characterId:true}});
    if (!owned) throw new ConversationError('Not found', 404);
    if (owned.userId !== userId) throw new ConversationError('Forbidden', 403);
    let aiModel:string|null|undefined;
    if(requestedModel===null)aiModel=null;
    else if(requestedModel!==undefined){
      const catalog=await readAiModelCatalog(owned.characterId,tx);
      if(typeof requestedModel!=='string'||!catalog.models.includes(requestedModel))throw new ConversationError('所选模型不在当前角色可用范围内。',400);
      aiModel=requestedModel;
    }
    const conversation = await tx.conversation.update({
      where: {id: conversationId},
      data: {
        ...(title !== undefined && {title}), ...(notes !== undefined && {notes}),
        ...(relationshipStatus !== undefined && {relationshipStatus}), ...(romance !== undefined && {romance}),
        ...(intimacy !== undefined && {intimacy}), ...(archived !== undefined && {archivedAt: archived ? new Date() : null}),
        ...(relationshipMode !== undefined && {relationshipMode}), ...(aiModel !== undefined && {aiModel}),
      },
      select: {id: true, title: true, relationshipStatus: true, romance: true, intimacy: true, notes: true, archivedAt: true, relationshipMode: true, aiModel: true, updatedAt: true},
    });
    return {conversation};
  });
}

export async function deleteConversation(userId: string, conversationId: string) {
  return db.$transaction(async tx => {
    const owned = await tx.conversation.findUnique({where: {id: conversationId}, select: {userId: true}});
    if (!owned) throw new ConversationError('Not found', 404);
    if (owned.userId !== userId) throw new ConversationError('Forbidden', 403);
    await tx.conversation.delete({where: {id: conversationId}});
    return {success: true};
  });
}
