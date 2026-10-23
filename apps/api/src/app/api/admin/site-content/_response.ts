import {NextResponse} from 'next/server';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';
import {privateHeaders, readJsonBody} from '@rumiai/backend/infrastructure/http';
import {SiteContentError} from '@rumiai/backend/modules/site-content/errors';

export {privateHeaders};
export function siteContentErrorResponse(error: unknown, route: string) {
  if (error instanceof SiteContentError) return NextResponse.json({error: error.message}, {status: error.status, headers: privateHeaders});
  logRouteError(route, error);
  return NextResponse.json({error: '站点内容管理操作失败，请刷新核对状态。'}, {status: 500, headers: privateHeaders});
}
export const readJson = (request: Request, maxBytes = 40_000) => readJsonBody(request, {maxBytes});
