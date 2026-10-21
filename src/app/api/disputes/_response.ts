import {NextResponse} from 'next/server';
import {logRouteError} from '@/lib/logger';
import {disputeErrorResponse} from '@/lib/disputes/case-service';
import {readJsonBody} from '@/lib/http';

/** 评理接口共用的错误出口：领域错误原样返回中文与状态码，其余记日志并给 500。 */
export function disputeError(error: unknown, message: string, route: string) {
  const known = disputeErrorResponse(error);
  if (known) return NextResponse.json({error: known.message}, {status: known.status, ...(known.headers ? {headers: known.headers} : {})});
  logRouteError(route, error);
  return NextResponse.json({error: message}, {status: 500});
}

export const readJson = (request: Request, maxBytes = 40_000) => readJsonBody(request, {tooLarge: '内容过大。', headers: {}, maxBytes});
