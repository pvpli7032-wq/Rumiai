import {NextResponse} from 'next/server';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {readRequestId} from '@rumiai/backend/modules/billing/turn';
import {readTurnState} from '@rumiai/backend/modules/conversations/turn-query';

/**
 * 断线查询（V3 §20）：客户端拿同一次点击的请求号回来问「这条到底成了没有」，
 * 查到就补消息、不再重发；查不到才允许手动重试。
 */
export async function GET(request: Request, {params: paramsPromise}: {params: Promise<{id: string}>}) {
  const params = await paramsPromise;
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const requestId = readRequestId(new URL(request.url).searchParams.get('requestId'));
    if (!requestId) return NextResponse.json({error: '缺少请求编号。'}, {status: 400});
    const turn = await readTurnState(authUser.userId, params.id, requestId);
    // 别人的对话与不存在的对话同样回 404，不泄露是否存在。
    if (!turn) return NextResponse.json({error: '找不到这条请求记录。'}, {status: 404});
    return NextResponse.json(turn);
  } catch (error) {
    logRouteError('GET /api/conversations/[id]/turns', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
