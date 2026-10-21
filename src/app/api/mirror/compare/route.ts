import {NextResponse} from 'next/server';
import {mirrorErrorResponse, readRequestState} from '../_shared';
import {compareMirrorResults, readMirrorRules} from '@/lib/mirror';

export const dynamic = 'force-dynamic';

/** 对比：登录后最多同时看 compareLimit 个角色的结果，只是读，不重复生成也不重复收费。 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const state = await readRequestState(request);
    if (!state.userId) return NextResponse.json({error: '登录后才能对比角色。', code: 'MIRROR_LOGIN_REQUIRED'}, {status: 401});
    const rules = await readMirrorRules(state.userId);
    const views = await compareMirrorResults(url.searchParams.getAll('shareId'), state.userId, rules.compareLimit);
    return NextResponse.json({views, compareLimit: rules.compareLimit});
  } catch (error) {
    return mirrorErrorResponse('GET /api/mirror/compare', error);
  }
}
