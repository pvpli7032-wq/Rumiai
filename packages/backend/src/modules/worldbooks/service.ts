import {db} from '@rumiai/backend/infrastructure/database/client';
import {readSettingValue} from '@rumiai/backend/modules/settings/index';
import {ChatContextError, object, text} from '@rumiai/backend/modules/conversations/context/access';

async function own(userId: string, id: string) {
  const book = await db.worldbook.findUnique({where: {id}});
  if (!book || book.userId !== userId) throw new ChatContextError('世界书不存在。', 404);
  return book;
}
export async function listWorldbooks(userId: string) {
  const [items, entryMaxChars, maxEntries] = await Promise.all([
    db.worldbook.findMany({where: {userId}, include: {_count: {select: {entries: true}}}, orderBy: [{updatedAt: 'desc'}, {id: 'asc'}]}),
    readSettingValue<number>('chat.worldbooks.entryMaxChars'), readSettingValue<number>('chat.worldbooks.maxEntries'),
  ]);
  return {items, entryMaxChars, maxEntries};
}
export async function readWorldbook(userId: string, id: string) {
  const book = await own(userId, id);
  return {...book, entries: await db.worldbookEntry.findMany({where: {worldbookId: id}, orderBy: [{priority: 'desc'}, {id: 'asc'}]}).then(rows => rows.map(row => ({...row, keywords: JSON.parse(row.keywordsJson) as string[]})))};
}
export async function saveWorldbook(userId: string, id: string | null, value: unknown) {
  const input = object(value), name = text(input.name, '世界书名称', 80);
  const data = {name, enabled: input.enabled !== false, isPublic: input.isPublic === true};
  if (!id) return db.worldbook.create({data: {userId, ...data}});
  const existing = await own(userId, id);
  if (input.version !== existing.version) throw new ChatContextError('世界书已更新，请刷新。', 409);
  return db.$transaction(async tx => {
    const changed = await tx.worldbook.updateMany({where: {id, userId, version: existing.version}, data: {...data, version: {increment: 1}}});
    if (!changed.count) throw new ChatContextError('世界书已更新，请刷新。', 409);
    if (!data.isPublic) await tx.characterWorldbook.deleteMany({where: {worldbookId: id, character: {isPublic: true}}});
    return tx.worldbook.findUniqueOrThrow({where: {id}});
  });
}
export async function deleteWorldbook(userId: string, id: string) {
  await own(userId, id);
  await db.worldbook.delete({where: {id}});
  return {success: true};
}
export async function saveWorldbookEntry(userId: string, bookId: string, id: string | null, value: unknown) {
  await own(userId, bookId);
  const input = object(value);
  const [maxChars, maxEntries] = await Promise.all([readSettingValue<number>('chat.worldbooks.entryMaxChars'), readSettingValue<number>('chat.worldbooks.maxEntries')]);
  const keywords = Array.isArray(input.keywords) ? [...new Set(input.keywords.map(value => text(value, '触发词', 80)).filter(Boolean))] : [];
  if (!keywords.length || keywords.length > 20) throw new ChatContextError('请填写1–20个触发词。');
  const priority = input.priority ?? 0;
  if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < -1000 || priority > 1000) throw new ChatContextError('优先级须为-1000至1000的整数。');
  const data = {keywordsJson: JSON.stringify(keywords), content: text(input.content, '条目内容', maxChars), priority, enabled: input.enabled !== false};
  return db.$transaction(async tx => {
    await tx.worldbook.update({where: {id: bookId}, data: {version: {increment: 1}}});
    if (id) {
      const existing = await tx.worldbookEntry.findUnique({where: {id}});
      if (!existing || existing.worldbookId !== bookId) throw new ChatContextError('条目不存在。', 404);
      return tx.worldbookEntry.update({where: {id}, data});
    }
    if (await tx.worldbookEntry.count({where: {worldbookId: bookId}}) >= maxEntries) throw new ChatContextError('世界书条目已达上限。', 409);
    return tx.worldbookEntry.create({data: {worldbookId: bookId, ...data}});
  });
}
export async function deleteWorldbookEntry(userId: string, bookId: string, id: string) {
  await own(userId, bookId);
  const result = await db.worldbookEntry.deleteMany({where: {id, worldbookId: bookId}});
  if (!result.count) throw new ChatContextError('条目不存在。', 404);
  return {success: true};
}
export async function bindCharacterWorldbook(userId: string, characterId: string, bookId: string, bind: boolean) {
  const book = await own(userId, bookId);
  const character = await db.character.findUnique({where: {id: characterId}, select: {creatorId: true, isPublic: true}});
  if (!character || character.creatorId !== userId) throw new ChatContextError('只能管理自己角色的世界书。', 404);
  if (bind && character.isPublic && !book.isPublic) throw new ChatContextError('公开角色只能绑定已公开的世界书。');
  if (bind) await db.characterWorldbook.upsert({where: {characterId_worldbookId: {characterId, worldbookId: bookId}}, create: {characterId, worldbookId: bookId}, update: {}});
  else await db.characterWorldbook.deleteMany({where: {characterId, worldbookId: bookId}});
  return {success: true};
}
