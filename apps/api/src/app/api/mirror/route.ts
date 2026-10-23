import {NextResponse} from 'next/server';
import {applyMirrorCookies, mirrorErrorResponse, readRequestState} from './_shared';
import {readPageView} from './_page';
import {generateMirror} from '@rumiai/backend/modules/mirror/service';

export const dynamic = 'force-dynamic';

/**
 * 首页初始化：返回可选角色、规则与额度，并给匿名访客签发主体 Cookie。
 * 页面是 Server Component，不能写 Cookie，所以匿名双路计数从这里开始。
 */
export async function GET(request: Request) {
  try {
    const {cookies, ...payload} = await readPageView(await readRequestState(request));
    return applyMirrorCookies(NextResponse.json(payload), cookies);
  } catch (error) {
    return mirrorErrorResponse('GET /api/mirror', error);
  }
}

/** 生成：一次调用 + 至多一次格式修复；失败不占额度。 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({error: '请求数据格式不正确。', code: 'MIRROR_BODY_INVALID'}, {status: 400});
  }
  try {
    const state = await readRequestState(request);
    const payload = (body ?? {}) as {answers?: unknown; characterId?: unknown; requestId?: unknown};
    const generated = await generateMirror(state, payload);
    return applyMirrorCookies(NextResponse.json({result: generated.result, quota: generated.quota}), generated.cookies);
  } catch (error) {
    return mirrorErrorResponse('POST /api/mirror', error);
  }
}
