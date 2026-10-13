import {NextResponse} from 'next/server';
import {CircleError} from '@/lib/circles/service';
import {logRouteError} from '@/lib/logger';

export const privateHeaders = {'Cache-Control': 'private, no-store'};
export function circleError(error: unknown, route: string) {
  if (error instanceof CircleError) return NextResponse.json({error: error.message, ...(error.reason !== undefined ? {reason: error.reason} : {})}, {status: error.status, headers: {...privateHeaders, ...(error.retryAfter !== undefined ? {'Retry-After': String(error.retryAfter)} : {})}});
  logRouteError(route, error);
  return NextResponse.json({error: '圈子操作失败，请稍后重试。'}, {status: 500, headers: privateHeaders});
}
