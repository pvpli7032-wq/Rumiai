import {NextResponse} from 'next/server';
import {listAdminTasks} from '@rumiai/backend/modules/admin/tasks-admin';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';

export const dynamic = 'force-dynamic';

/** 后台任务总览：名称、启用状态、最近运行、结果与失败次数。 */
export async function GET(request: Request) {
  const access = await requireAdmin(request, 'tasks.read');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备任务查看权限的管理员可以查看后台任务。');
  try {
    return NextResponse.json(await listAdminTasks(), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/tasks', '任务列表加载失败，请稍后重试。');
  }
}
