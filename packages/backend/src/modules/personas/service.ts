import {db} from '@rumiai/backend/infrastructure/database/client';
import {readSettingValue} from '@rumiai/backend/modules/settings/index';
import {ChatContextError, object, text} from '@rumiai/backend/modules/conversations/context/access';

export async function listPersonas(userId: string) {
  return {items: await db.userPersona.findMany({where: {userId}, orderBy: [{updatedAt: 'desc'}, {id: 'asc'}]}), maxChars: await readSettingValue<number>('chat.personaMaxChars')};
}
export async function savePersona(userId: string, id: string | null, value: unknown) {
  const input = object(value), maxChars = await readSettingValue<number>('chat.personaMaxChars');
  const data = {name: text(input.name, '身份名称', 80), description: text(input.description, '身份描述', maxChars)};
  return db.$transaction(async tx => {
    if (!id) return tx.userPersona.create({data: {userId, ...data}});
    const existing = await tx.userPersona.findUnique({where: {id}});
    if (!existing || existing.userId !== userId) throw new ChatContextError('身份不存在。', 404);
    if (input.version !== existing.version) throw new ChatContextError('身份已被更新，请重新读取。', 409);
    const changed = await tx.userPersona.updateMany({where: {id, userId, version: existing.version}, data: {...data, version: {increment: 1}}});
    if (!changed.count) throw new ChatContextError('身份已更新，请刷新。', 409);
    await tx.conversationMemory.deleteMany({where: {conversation: {userId, personaId: id}}});
    return tx.userPersona.findUniqueOrThrow({where: {id}});
  });
}
export async function deletePersona(userId: string, id: string) {
  return db.$transaction(async tx => {
    const existing = await tx.userPersona.findUnique({where: {id}});
    if (!existing || existing.userId !== userId) throw new ChatContextError('身份不存在。', 404);
    await tx.conversationMemory.deleteMany({where: {conversation: {userId, personaId: id}}});
    await tx.userPersona.delete({where: {id}});
    return {success: true};
  });
}
