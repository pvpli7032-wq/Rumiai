import {NextResponse} from 'next/server';
import {PostManagementError} from '@/lib/posts/errors';
import {logRouteError} from '@/lib/logger';

export function postErrorResponse(error: unknown, message: string, route?: string) {
  if (error instanceof PostManagementError || error instanceof Error && 'status' in error && typeof error.status === 'number') {
    const status = Number(error.status), retryAfter = error instanceof PostManagementError ? error.retryAfter : undefined;
    return NextResponse.json({error: error.message}, {status, ...(retryAfter ? {headers: {'Retry-After': String(retryAfter)}} : {})});
  }
  if (route) logRouteError(route, error);
  return NextResponse.json({error: message}, {status: 500});
}
export function parseCommunityBody(request: Request, maxBytes = 40_000) {
  const size = Number(request.headers.get('content-length') || 0);
  return size > maxBytes ? NextResponse.json({error: '内容过大。'}, {status: 413}) : null;
}
export async function readJson(request: Request, maxBytes = 40_000) {
  const limited = parseCommunityBody(request, maxBytes);
  if (limited) return {response: limited};
  try { return {input: await request.json() as unknown}; }
  catch { return {response: NextResponse.json({error: '请求数据格式不正确。'}, {status: 400})}; }
}
