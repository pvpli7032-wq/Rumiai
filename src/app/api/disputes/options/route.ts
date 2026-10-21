import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {readDisputeOptions} from '@/lib/disputes/case-service';
import {disputeError} from '../_response';

export const dynamic = 'force-dynamic';

/** 发起页与详情页共用的公开规则；登录后附带今日剩余次数与注册时长资格。 */
export async function GET(request: Request) {
  try {
    const auth = await getAuthUser(request);
    return NextResponse.json({options: await readDisputeOptions(auth?.userId ?? null)}, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    return disputeError(error, '规则加载失败，请稍后重试。', 'GET /api/disputes/options');
  }
}
