import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {withdrawDisputeCase} from '@/lib/disputes/withdraw-service';
import {disputeError} from '../../_response';

export const dynamic = 'force-dynamic';

/** 撤回：停止公开访问；评论与举报记录保留。 */
export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401});
    const {id} = await params;
    return NextResponse.json(await withdrawDisputeCase(auth.userId, id), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    return disputeError(error, '撤回失败，请稍后重试。', 'POST /api/disputes/[id]/withdraw');
  }
}
