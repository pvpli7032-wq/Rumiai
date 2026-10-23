import {NextResponse} from 'next/server';
import {PostManagementError} from '@rumiai/backend/modules/posts/errors';
import {readJsonBody} from '@rumiai/backend/infrastructure/http';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';

/** 社区内容的超限文案与响应头沿用旧线：不带 no-store，提示也更短。 */
const communityBody = {tooLarge: '内容过大。', headers: {}};

export function postErrorResponse(error: unknown, message: string, route?: string) {
  if (error instanceof PostManagementError || error instanceof Error && 'status' in error && typeof error.status === 'number') {
    const status = Number(error.status), retryAfter = error instanceof PostManagementError ? error.retryAfter : undefined;
    return NextResponse.json({error: error.message}, {status, ...(retryAfter ? {headers: {'Retry-After': String(retryAfter)}} : {})});
  }
  if (route) logRouteError(route, error);
  return NextResponse.json({error: message}, {status: 500});
}
export const readJson = (request: Request, maxBytes = 40_000) =>
  readJsonBody(request, {...communityBody, maxBytes});
