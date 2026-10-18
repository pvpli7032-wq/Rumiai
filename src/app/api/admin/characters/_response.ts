import {NextResponse} from 'next/server';
import {CharacterManagementError} from '@/lib/characters/management-service';
import {logRouteError} from '@/lib/logger';
export const privateHeaders = {'Cache-Control': 'private, no-store'};
export function managementError(error: unknown, route: string) {
  if (error instanceof CharacterManagementError) return NextResponse.json({error: error.message}, {status: error.status, headers: privateHeaders});
  logRouteError(route, error);
  return NextResponse.json({error: '角色管理操作失败，请稍后重试。'}, {status: 500, headers: privateHeaders});
}
