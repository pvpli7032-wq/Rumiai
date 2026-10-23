import {NextResponse} from 'next/server';
import {hideAdminDisputeCase} from '@rumiai/backend/modules/admin/dispute-cases-admin';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';

export const dynamic = 'force-dynamic';

type Context = {params: Promise<{id: string}>};

/** 后台隐藏：停止公开访问、停止投票、不再进入结案任务；原因与操作人写进 admin_audit_logs。 */
export async function POST(request: Request, context: Context) {
  const access = await requireAdmin(request, 'disputes.manage');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备评理管理权限的管理员可以隐藏案例。');
  const {id} = await context.params;
  const body = await request.json().catch(() => null) as {reason?: unknown} | null;
  try {
    return NextResponse.json(await hideAdminDisputeCase(access.user.userId, id, body?.reason), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'POST /api/admin/disputes/cases/[id]/hide', '隐藏失败，请稍后重试。');
  }
}
