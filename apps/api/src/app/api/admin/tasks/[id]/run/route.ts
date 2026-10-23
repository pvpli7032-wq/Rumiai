import {NextResponse} from 'next/server';
import {runAdminTaskOnce} from '@rumiai/backend/modules/admin/tasks-admin';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';

export const dynamic = 'force-dynamic';

type Context = {params: Promise<{id: string}>};

/** 手动执行一次：只处理当前已到期的任务，不改开关。 */
export async function POST(request: Request, context: Context) {
  const access = await requireAdmin(request, 'tasks.manage');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备任务执行权限的管理员可以手动运行任务。');
  const {id} = await context.params;
  try {
    return NextResponse.json(await runAdminTaskOnce(id), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'POST /api/admin/tasks/[id]/run', '任务执行失败，请稍后重试。');
  }
}
