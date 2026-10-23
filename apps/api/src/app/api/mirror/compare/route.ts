import {NextResponse} from 'next/server';
import {mirrorErrorResponse, readRequestState} from '../_shared';
import {compareMirrorResults, readMirrorRules} from '@rumiai/backend/modules/mirror/index';

export const dynamic = 'force-dynamic';

/**
 * 对比：登录后最多同时看 compareLimit 个角色的结果（V3 §23）。
 *
 * 纯读接口：不生成、不扣费。每条 shareId 独立成条并带自己的状态，
 * 失败的那条前台可以只重取它，不需要整组重发。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const state = await readRequestState(request);
    if (!state.userId) return NextResponse.json({error: '登录后才能对比角色。', code: 'MIRROR_LOGIN_REQUIRED'}, {status: 401});
    const rules = await readMirrorRules(state.userId);
    const entries = await compareMirrorResults(url.searchParams.getAll('shareId'), rules.compareLimit);
    return NextResponse.json({entries, compareLimit: rules.compareLimit});
  } catch (error) {
    return mirrorErrorResponse('GET /api/mirror/compare', error);
  }
}
