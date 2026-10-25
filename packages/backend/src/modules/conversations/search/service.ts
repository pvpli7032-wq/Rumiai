import {db} from '@rumiai/backend/infrastructure/database/client';
import {ChatContextError} from '../context/access';

export async function searchConversationMessages(userId: string, query: string, before?: string | null) {
  const q = query.trim();
  if (!q || q.length > 160) throw new ChatContextError('请输入1–160字搜索内容。', 422);
  let cursor: {createdAt: Date; id: string} | null = null;
  if (before) try {const value = JSON.parse(Buffer.from(before, 'base64url').toString()); cursor = {id: value.id, createdAt: new Date(value.createdAt)}; if (!cursor.id || Number.isNaN(cursor.createdAt.getTime())) throw Error();} catch {throw new ChatContextError('搜索游标无效。', 422);}
  const rows = await db.message.findMany({
    where: {content: {contains: q}, conversation: {userId, storyRun: {is: null}}, ...(cursor ? {OR: [{createdAt: {lt: cursor.createdAt}}, {createdAt: cursor.createdAt, id: {lt: cursor.id}}]} : {})},
    orderBy: [{createdAt: 'desc'}, {id: 'desc'}], take: 31,
    select: {id: true, conversationId: true, content: true, createdAt: true, role: true, conversation: {select: {title: true}}},
  });
  const page = rows.slice(0, 30), last = page[page.length - 1];
  return {items: page.map(row => {const index = row.content.toLocaleLowerCase().indexOf(q.toLocaleLowerCase()); return {...row, content: undefined, snippet: row.content.slice(Math.max(0, index - 35), Math.max(0, index - 35) + 180)};}), nextCursor: rows.length > 30 && last ? Buffer.from(JSON.stringify({createdAt: last.createdAt.toISOString(), id: last.id})).toString('base64url') : null};
}
