import {NextResponse} from 'next/server';
import {logRouteError} from '@/lib/logger';
import {SiteContentError} from '@/lib/site-content/errors';

export const privateHeaders = {'Cache-Control': 'private, no-store'};
export function siteContentErrorResponse(error: unknown, route: string) {
  if (error instanceof SiteContentError) return NextResponse.json({error: error.message}, {status: error.status, headers: privateHeaders});
  logRouteError(route, error);
  return NextResponse.json({error: '站点内容管理操作失败，请刷新核对状态。'}, {status: 500, headers: privateHeaders});
}
export async function readJson(request: Request, maxBytes = 40_000) {
  const size = Number(request.headers.get('content-length') || 0);
  if (size > maxBytes) return {response: NextResponse.json({error: '请求数据过大。'}, {status: 413, headers: privateHeaders})};
  try {return {input: await request.json() as unknown};}
  catch {return {response: NextResponse.json({error: '请求数据格式不正确。'}, {status: 400, headers: privateHeaders})};}
}
