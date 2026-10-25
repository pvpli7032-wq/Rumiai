import { NextResponse } from 'next/server';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { ConversationError, readConversationExport } from '@rumiai/backend/modules/conversations/conversation-service';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, {params: paramsPromise}: {params: Promise<{id: string}>}) {
  const {id} = await paramsPromise;
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({error: '请先登录。'}, {status: 401});
    const format = new URL(request.url).searchParams.get('format') || 'json';
    if (format !== 'json' && format !== 'txt') return NextResponse.json({error: '导出格式仅支持 JSON 或文本。'}, {status: 400});
    const {conversation, messages} = await readConversationExport(user.userId, id);
    const exportedAt = new Date().toISOString();
    const labels: Record<string, string> = {USER: '我', ASSISTANT: 'AI 角色', SYSTEM: '系统'};
    const text = format === 'json'
      ? JSON.stringify({exportedAt, conversation, messages}, null, 2)
      : '\ufeff' + [
          '星伴聊天记录', `角色：${conversation.character.name}`, `对话：${conversation.title || conversation.id}`, `导出时间：${exportedAt}`,
          ...(conversation.notes ? [`我的笔记：${conversation.notes}`] : []), '',
          ...messages.map(message => `[${message.createdAt.toISOString()}] ${labels[message.role] || message.role}\n${message.content}${message.imageUrl ? '\n图片：' + message.imageUrl : ''}${message.attachments.map(attachment => attachment.type === 'IMAGE' ? '\n图片：' + attachment.url : '\n贴纸：' + attachment.stickerId).join('')}\n`),
        ].join('\n');
    return new Response(text, {headers: {
      'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="xingban-chat-${conversation.id}.${format}"`,
      'Cache-Control': 'private, no-store',
    }});
  } catch (error) {
    if (error instanceof ConversationError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('GET conversation export', error);
    return NextResponse.json({error: '导出失败，请重试。'}, {status: 500});
  }
}
