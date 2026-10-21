import {NextResponse} from 'next/server';
import {mirrorErrorResponse, readRequestState} from '../_shared';
import {readMyMirrorResults} from '@/lib/mirror';

export const dynamic = 'force-dynamic';

/** 我的结果：登录用户按 userId，匿名访客按服务端签发的主体标识。 */
export async function GET(request: Request) {
  try {
    const state = await readRequestState(request);
    return NextResponse.json({results: await readMyMirrorResults(state.userId, state.subject)});
  } catch (error) {
    return mirrorErrorResponse('GET /api/mirror/mine', error);
  }
}
