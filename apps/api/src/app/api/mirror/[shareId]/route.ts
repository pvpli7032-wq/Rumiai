import {NextResponse} from 'next/server';
import {applyMirrorCookies, mirrorErrorResponse, readAttribution, readRequestState} from '../_shared';
import {deleteMirrorResult, readMirrorResult} from '@rumiai/backend/modules/mirror/index';
import {MIRROR_SUBJECT_COOKIE} from '@rumiai/backend/modules/mirror/index';

export const dynamic = 'force-dynamic';

/**
 * 单条结果。公开视图只给结果字段；本人或归属凭据持有人额外拿到三题原回答。
 * 删除后、过期后一律 404。
 */
export async function GET(request: Request, context: {params: Promise<{shareId: string}>}) {
  const {shareId} = await context.params;
  try {
    const state = await readRequestState(request);
    const view = await readMirrorResult(shareId, {userId: state.userId, subject: state.subject}, readAttribution(request, shareId));
    const response = NextResponse.json(view);
    // 匿名访客再次打开时刷新主体 Cookie，保证之后仍认得出自己的结果。
    if (!state.userId && state.subject) {
      return applyMirrorCookies(response, [{name: MIRROR_SUBJECT_COOKIE, value: state.subject, maxAge: 60 * 60 * 24 * 365, httpOnly: true}]);
    }
    return response;
  } catch (error) {
    return mirrorErrorResponse('GET /api/mirror/[shareId]', error);
  }
}

/** 本人可删；匿名凭创建时签发的归属凭据删。 */
export async function DELETE(request: Request, context: {params: Promise<{shareId: string}>}) {
  const {shareId} = await context.params;
  try {
    const state = await readRequestState(request);
    await deleteMirrorResult(shareId, {userId: state.userId, subject: state.subject}, readAttribution(request, shareId));
    return new NextResponse(null, {status: 204});
  } catch (error) {
    return mirrorErrorResponse('DELETE /api/mirror/[shareId]', error);
  }
}
