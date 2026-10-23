import {NextResponse} from 'next/server';
import {hideAdminMirrorResult, restoreAdminMirrorResult} from '@rumiai/backend/modules/admin/mirror-results-admin';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';

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

/**
 * 恢复一条被隐藏的结果（V3 表 19）：按过期时间还原成 READY 或 EXPIRED，
 * 不把已经过期的内容恢复成可访问状态。权限与隐藏同一档。
 */
export async function PATCH(request: Request, context: Context) {
  const access = await requireAdmin(request, 'mirror.manage');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备 Mirror 管理权限的管理员可以恢复结果。');
  const {id} = await context.params;
  try {
    return NextResponse.json(await restoreAdminMirrorResult(id), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'PATCH /api/admin/mirror/results/[id]', '恢复失败，请稍后重试。');
  }
}
