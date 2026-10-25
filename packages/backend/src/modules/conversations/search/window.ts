import {db} from '@rumiai/backend/infrastructure/database/client';
import {attachmentSelect, messageView} from '../attachments/view';
import {ownedMessage} from '../context/access';
export async function readMessageWindow(userId: string, conversationId: string, messageId: string) {
  const {message} = await ownedMessage(userId, conversationId, messageId);
  const select = {id: true, role: true, content: true, likedAt: true, createdAt: true, contextIncluded: true, selectedVersionId: true, attachments: {select: attachmentSelect}} as const;
  const [before, after] = await Promise.all([
    db.message.findMany({where: {conversationId, OR: [{createdAt: {lt: message.createdAt}}, {createdAt: message.createdAt, id: {lte: message.id}}]}, orderBy: [{createdAt: 'desc'}, {id: 'desc'}], take: 51, select}),
    db.message.findMany({where: {conversationId, OR: [{createdAt: {gt: message.createdAt}}, {createdAt: message.createdAt, id: {gt: message.id}}]}, orderBy: [{createdAt: 'asc'}, {id: 'asc'}], take: 20, select}),
  ]);
  const earliest = before.slice(0, 50).reverse(), first = earliest[0];
  return {messages: [...earliest, ...after].map(messageView), hasMore: before.length > 50, nextCursor: before.length > 50 && first ? Buffer.from(JSON.stringify({createdAt: first.createdAt.toISOString(), id: first.id})).toString('base64url') : null, targetMessageId: messageId};
}
