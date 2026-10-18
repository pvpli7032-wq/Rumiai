import {NextResponse} from 'next/server';
import {AccountManagementError} from '@/lib/accounts/management-service';
import {logRouteError} from '@/lib/logger';
export const privateHeaders = {'Cache-Control': 'private, no-store'};
export function accountManagementError(error: unknown, route: string) {
  if (error instanceof AccountManagementError) return NextResponse.json({error: error.message}, {status: error.status, headers: privateHeaders});
  logRouteError(route, error);
  return NextResponse.json({error: '用户管理操作失败，请稍后重试。'}, {status: 500, headers: privateHeaders});
}
