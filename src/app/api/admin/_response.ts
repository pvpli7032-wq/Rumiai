import {NextResponse} from 'next/server';
import {AdminManagementError} from '@/lib/admin/management-service';
import {logRouteError} from '@/lib/logger';

export const privateHeaders = {'Cache-Control': 'private, no-store'};
export function adminErrorResponse(error: unknown, route: string) {
  if (error instanceof AdminManagementError) return NextResponse.json({error: error.message}, {status: error.status, headers: privateHeaders});
  logRouteError(route, error);
  return NextResponse.json({error: '管理操作失败，请刷新核对状态。'}, {status: 500, headers: privateHeaders});
}
