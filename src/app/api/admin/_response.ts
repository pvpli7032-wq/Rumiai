import {NextResponse} from 'next/server';
import {AdminManagementError} from '@/lib/admin/management-service';
import {privateHeaders} from '@/lib/http';
import {logRouteError} from '@/lib/logger';

export {privateHeaders};
export function adminErrorResponse(error: unknown, route: string) {
  if (error instanceof AdminManagementError) return NextResponse.json({error: error.message}, {status: error.status, headers: privateHeaders});
  logRouteError(route, error);
  return NextResponse.json({error: '管理操作失败，请刷新核对状态。'}, {status: 500, headers: privateHeaders});
}
