import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {SITE_URL} from '@/lib/i18n';
import {jsonError, requireUser, unauthorized} from '@/lib/http';

export const dynamic = 'force-dynamic';

/** 分享出去的对话最多摘几条，避免一条公开链接把整段私人对话摊开。 */
const EXCERPT_TURNS = 12;

/**
 * 分享这一段对话（V3 表 15 聊天页「分享」）。
 *
 * 只读、无副作用：返回一个指向 /share/chat/{id} 的链接，公开页自己按 ownerId
 * 出内容。使用者必须是这段对话的主人，别人的对话连「存在」都不确认。
 * 不带消息 ID 的单条分享不做——那需要一张持久化的分享表，属于新表，不在本次范围。
 */
export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const {id} = await params;
  try {
    const conversation = await db.conversation.findUnique({
      where: {id},
      select: {
        id: true, userId: true, title: true, character: {select: {name: true}},
        messages: {orderBy: [{createdAt: 'desc'}, {id: 'desc'}], take: EXCERPT_TURNS, select: {id: true}},
      },
    });
    if (!conversation || conversation.userId !== user.userId) {
      return NextResponse.json({error: '对话不存在或已删除。', code: 'NOT_FOUND'}, {status: 404, headers: {'Cache-Control': 'no-store'}});
    }
    if (conversation.messages.length === 0) {
      return NextResponse.json({error: '这段对话还没有消息，没有可分享的内容。', code: 'EMPTY'}, {status: 400, headers: {'Cache-Control': 'no-store'}});
    }
    return NextResponse.json({
      url: `${SITE_URL}/share/chat/${conversation.id}`,
      path: `/share/chat/${conversation.id}`,
      characterName: conversation.character?.name ?? null,
      title: conversation.title ?? null,
      turnCount: conversation.messages.length,
    }, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {
    return jsonError(error, 'POST /api/conversations/[id]/share', '生成分享链接失败，请稍后重试。');
  }
}
