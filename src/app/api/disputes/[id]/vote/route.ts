import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {enqueueCloseIfReached} from '@/lib/disputes/close-service';
import {voteDispute} from '@/lib/disputes/vote-service';
import {disputeError, readJson} from '../../_response';

export const dynamic = 'force-dynamic';

/** 投票与改票：每种选择一人一票，改票次数按创建时快照。 */
export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401});
    const parsed = await readJson(request);
    if (parsed.response) return parsed.response;
    const {id} = await params;
    const result = await voteDispute(id, auth.userId, parsed.input);
    // 票数先到：登记结案任务；真正的生成在任务进程里做，响应不等模型。
    if (result.voteCount >= result.closeAtVotes) await enqueueCloseIfReached(id).catch(() => false);
    return NextResponse.json({vote: {choice: result.choice, reviseCount: result.reviseCount}, voteCount: result.voteCount, closing: result.voteCount >= result.closeAtVotes}, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    return disputeError(error, '投票失败，请稍后重试。', 'POST /api/disputes/[id]/vote');
  }
}
