import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {readExcerptCandidates, readDisputeOptions} from '@/lib/disputes/case-service';
import {disputeError} from '../_response';

export const dynamic = 'force-dynamic';

/**
 * 发起页的候选消息。只读当前用户自己的会话，并只返回最近一段窗口；
 * 摘录快照在提交时按 messageIds 重新取，前端传什么都不影响服务端判断。
 */
export async function GET(request: Request) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401});
    const conversationId = new URL(request.url).searchParams.get('conversationId') ?? '';
    const options = await readDisputeOptions(auth.userId);
    const result = await readExcerptCandidates(auth.userId, conversationId);
    return NextResponse.json({...result, maxExcerptMessages: options.maxExcerptMessages, claimMaxChars: options.claimMaxChars, eligible: options.eligible, remaining: options.remaining}, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    return disputeError(error, '聊天消息加载失败，请稍后重试。', 'GET /api/disputes/excerpt');
  }
}
