import {db} from '@rumiai/backend/infrastructure/database/client';
import {ChatContextError, ownedMessage} from '../context/access';

export async function createConversationBranch(userId: string, conversationId: string, messageId: string) {
  const {conversation, message} = await ownedMessage(userId, conversationId, messageId);
  return db.$transaction(async tx => {
    const rows = await tx.message.findMany({where: {conversationId, OR: [{createdAt: {lt: message.createdAt}}, {createdAt: message.createdAt, id: {lte: message.id}}]}, orderBy: [{createdAt: 'asc'}, {id: 'asc'}], take: 10001, include: {attachments: true}});
    if (rows.length > 10000) throw new ChatContextError('该分支历史过长，请先导出或选择更早的分支位置。', 422);
    const event = await tx.conversationRelationshipEvent.findFirst({where: {conversationId, messageId: {in: rows.map(row => row.id)}}, orderBy: {createdAt: 'desc'}});
    const branch = await tx.conversation.create({data: {
      userId, characterId: conversation.characterId, sceneId:conversation.sceneId, title: (conversation.title || conversation.character.name) + ' · 分支',
      parentConversationId: conversationId, forkMessageId: messageId, personaId: conversation.personaId,
      personalCharacterOverride: conversation.personalCharacterOverride, responseStyle: conversation.responseStyle, responseLength: conversation.responseLength,
      relationshipMode: conversation.relationshipMode, aiModel: conversation.aiModel,
      romance: event?.romanceAfter ?? conversation.character.initialRomance, intimacy: event?.intimacyAfter ?? conversation.character.initialIntimacy,
    }});
    const messageMap = new Map<string, string>();
    for (const row of rows) {
      const copy = await tx.message.create({data: {conversationId: branch.id, role: row.role, content: row.content, contextIncluded: row.contextIncluded, createdAt: row.createdAt}});
      messageMap.set(row.id, copy.id);
      for (const attachment of row.attachments) {
        const {id: _id, messageId: _message, ...data} = attachment;
        await tx.messageAttachment.create({data: {...data, messageId: copy.id}});
      }
    }
    const facts = await tx.memoryFact.findMany({where: {conversationId, userId, status: 'ACTIVE', sourceMessageId: {in: [...messageMap.keys()]}}});
    for (const fact of facts) await tx.memoryFact.create({data: {conversationId: branch.id, userId, text: fact.text, pinned: fact.pinned, status: 'ACTIVE', sourceMessageId: fact.sourceMessageId ? messageMap.get(fact.sourceMessageId) : null}});
    const bindings = await tx.conversationWorldbook.findMany({where: {conversationId}});
    if (bindings.length) await tx.conversationWorldbook.createMany({data: bindings.map(binding => ({conversationId: branch.id, worldbookId: binding.worldbookId}))});
    return {id: branch.id, copiedMessages: rows.length};
  }, {timeout: 30000});
}
