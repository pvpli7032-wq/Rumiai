import {NextResponse} from 'next/server';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';
import {MirrorError, readMirrorContext, type MirrorContext, type MirrorCookieWrite} from '@rumiai/backend/modules/mirror/index';
import {mirrorAttributionCookieName, readCookie} from '@rumiai/backend/modules/mirror/index';

/**
 * Mirror 路由的公共部分：统一错误形状、Cookie 写入、归属凭据读取。
 * 路由文件共用这一份，避免每个文件各写一遍错误映射。
 */

export function mirrorErrorResponse(route: string, error: unknown) {
  if (error instanceof MirrorError) return NextResponse.json({error: error.message, code: error.code}, {status: error.status});
  logRouteError(route, error);
  return NextResponse.json({error: '服务暂时不可用，请稍后重试。'}, {status: 500});
}

export function applyMirrorCookies(response: NextResponse, cookies: MirrorCookieWrite[]) {
  for (const cookie of cookies) {
    response.cookies.set({name: cookie.name, value: cookie.value, maxAge: cookie.maxAge, httpOnly: cookie.httpOnly, sameSite: 'lax', path: '/'});
  }
  return response;
}

export type MirrorRequestState = MirrorContext;

export async function readRequestState(request: Request): Promise<MirrorRequestState> {
  return readMirrorContext(request);
}

/** 归属凭据 Cookie 名按结果区分，读取时只认这条结果自己的。 */
export function readAttribution(request: Request, shareId: string): string | null {
  return readCookie(request.headers.get('cookie'), mirrorAttributionCookieName(shareId));
}
