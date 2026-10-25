import {db} from '@rumiai/backend/infrastructure/database/client';
import {readSettingValue} from '@rumiai/backend/modules/settings/index';
import {ChatContextError, object, ownedConversation, text} from './access';
import {revisionPolicy} from '../revisions/policy';

export interface ResponseOption {key: string; label: string; instruction: string}
export async function responseOptions(key: string): Promise<ResponseOption[]> {
  const value = await readSettingValue(key) as unknown;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ResponseOption => Boolean(item && typeof item === 'object' && typeof item.key === 'string' && typeof item.label === 'string' && typeof item.instruction === 'string' && item.key.length <= 80 && item.instruction.length <= 4000));
}
export async function readConversationContextSettings(userId: string, conversationId: string) {
  const conversation = await ownedConversation(userId, conversationId);
  const [personas, books, bound, styles, lengths, overrideMaxChars, generation] = await Promise.all([
    db.userPersona.findMany({where: {userId}, orderBy: {updatedAt: 'desc'}}),
    db.worldbook.findMany({where: {OR: [{userId}, {isPublic: true, OR: [{characterBindings: {some: {characterId: conversation.characterId}}}, {conversationBindings: {some: {conversationId}}}]}]}, select: {id: true, name: true, userId: true, enabled: true, isPublic: true}}),
    db.conversationWorldbook.findMany({where: {conversationId}, select: {worldbookId: true}}),
    responseOptions('chat.responseStyles'), responseOptions('chat.responseLengths'), readSettingValue<number>('chat.personalOverrideMaxChars'),
    revisionPolicy(userId, conversation.characterId),
  ]);
  return {
    memoryEnabled: await readSettingValue<boolean>('memory.enabled'), characterId: conversation.characterId, canBindCharacterBooks: conversation.character.creatorId === userId,
    settings: {personaId: conversation.personaId, personalCharacterOverride: conversation.personalCharacterOverride || '', responseStyle: conversation.responseStyle, responseLength: conversation.responseLength, worldbookIds: bound.map(row => row.worldbookId).filter(id => books.some(book => book.id === id))},
    personas, worldbooks: books, styles: styles.map(({key, label}) => ({key, label})), lengths: lengths.map(({key, label}) => ({key, label})), overrideMaxChars,
    generation: {available: generation.available, reason: generation.reason, maxInstructionChars: generation.maxInstructionChars, modelName: generation.model?.displayName ?? null, coins: generation.quote?.coins ?? null, pricing: generation.quote?.pricing ?? null},
  };
}
export async function saveConversationContextSettings(userId: string, conversationId: string, value: unknown) {
  await ownedConversation(userId, conversationId);
  const input = object(value);
  const allowed = ['personaId', 'personalCharacterOverride', 'responseStyle', 'responseLength', 'worldbookIds'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new ChatContextError('包含不支持的上下文设置。');
  const data: {personaId?: string | null; personalCharacterOverride?: string | null; responseStyle?: string | null; responseLength?: string | null} = {};
  if ('personaId' in input) {
    if (input.personaId !== null && typeof input.personaId !== 'string') throw new ChatContextError('身份编号无效。');
    if (input.personaId && !await db.userPersona.findFirst({where: {id: input.personaId as string, userId}})) throw new ChatContextError('身份不存在。', 404);
    data.personaId = input.personaId as string | null;
  }
  if ('personalCharacterOverride' in input) data.personalCharacterOverride = text(input.personalCharacterOverride, '私人角色设定', await readSettingValue<number>('chat.personalOverrideMaxChars'), false) || null;
  for (const [field, setting] of [['responseStyle', 'chat.responseStyles'], ['responseLength', 'chat.responseLengths']] as const) if (field in input) {
    const selected = input[field];
    if (selected !== null && (typeof selected !== 'string' || !(await responseOptions(setting)).some(option => option.key === selected))) throw new ChatContextError('该回复选项不可用，请重新读取。', 409);
    data[field] = selected as string | null;
  }
  let bookIds: string[] | null = null;
  if ('worldbookIds' in input) {
    if (!Array.isArray(input.worldbookIds) || input.worldbookIds.some(id => typeof id !== 'string') || input.worldbookIds.length > 100) throw new ChatContextError('世界书列表无效。');
    bookIds = [...new Set(input.worldbookIds as string[])];
    const valid = await db.worldbook.count({where: {id: {in: bookIds}, OR: [{userId}, {isPublic: true}]}});
    if (valid !== bookIds.length) throw new ChatContextError('部分世界书不存在或无权使用。', 404);
  }
  await db.$transaction(async tx => {
    await tx.conversation.update({where: {id: conversationId}, data});
    if (bookIds) {await tx.conversationWorldbook.deleteMany({where: {conversationId}}); if (bookIds.length) await tx.conversationWorldbook.createMany({data: bookIds.map(worldbookId => ({conversationId, worldbookId}))});}
    await tx.conversationMemory.deleteMany({where: {conversationId}});
  });
  return readConversationContextSettings(userId, conversationId);
}
