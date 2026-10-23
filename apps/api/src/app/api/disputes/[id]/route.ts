import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {readDisputeCase, readDisputeOptions} from '@rumiai/backend/modules/disputes/case-service';
import {disputeError} from '../_response';

export const dynamic = 'force-dynamic';

/** 详情：摘录、投票、结案结果。只读，不发模型请求（V3 第 24 章）。 */
export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    const {id} = await params;
    const detail = await readDisputeCase(id, auth?.userId ?? null);
    const isAuthor = auth?.userId === detail.authorId;
    // 发起资格只用于发起页；详情只需知道评理总开关（关闭后新评论也停）。
    const options = await readDisputeOptions();
    return NextResponse.json({
      case: {
        ...detail,
        canVote: Boolean(auth) && !isAuthor && detail.closeStatus === 'OPEN' && !detail.withdrawn,
        // 发起人可以随时撤回；撤回后停止公开访问。
        canWithdraw: isAuthor && detail.closeStatus === 'OPEN' && !detail.withdrawn,
        canComment: options.enabled && !detail.withdrawn,
        myVote: detail.myVote ? {...detail.myVote, maxVoteChanges: detail.myVote.maxVoteChanges} : null,
      },
    }, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    return disputeError(error, '评理案例加载失败，请稍后重试。', 'GET /api/disputes/[id]');
  }
}
