import {NextResponse} from 'next/server';
import {hideAdminMirrorResult} from '@/lib/admin/mirror-results-admin';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@/lib/http';

export const dynamic = 'force-dynamic';

type Context = {params: Promise<{id: string}>};

/** 隐藏一条结果：分享码立即失效，记录保留以便与费用单对账。 */
export async function DELETE(request: Request, context: Context) {
  const access = await requireAdmin(request, 'mirror.manage');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备 Mirror 管理权限的管理员可以隐藏结果。');
  const {id} = await context.params;
  try {
    return NextResponse.json(await hideAdminMirrorResult(id), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'DELETE /api/admin/mirror/results/[id]', '隐藏失败，请稍后重试。');
  }
}
