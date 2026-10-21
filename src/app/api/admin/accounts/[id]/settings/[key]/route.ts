import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {SETTINGS_BY_KEY, deleteUserOverride, isUserOverridable} from '@/lib/settings';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@/lib/http';

export const dynamic = 'force-dynamic';

type Context = {params: Promise<{id: string; key: string}>};
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

function notFound(message: string) {
  return NextResponse.json({error: message, code: 'NOT_FOUND'}, {status: 404, headers: privateHeaders});
}

/** 删除用户特例，该用户立即回到公共值。 */
export async function DELETE(request: Request, context: Context) {
  const access = await requireAdmin(request, 'accounts.settings.manage');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备用户额度设置权限的管理员可以清除用户特例。');
  try {
    const params = await context.params;
    const userId = decodeURIComponent(params.id);
    const key = decodeURIComponent(params.key);
    if (!ID_PATTERN.test(userId)) return notFound('账号不存在或已注销。');
    if (!Object.hasOwn(SETTINGS_BY_KEY, key) || !isUserOverridable(key)) return notFound('该项不允许按用户覆盖。');
    const user = await db.user.findUnique({where: {id: userId}, select: {id: true, deletedAt: true}});
    if (!user || user.deletedAt) return notFound('账号不存在或已注销。');
    await deleteUserOverride({userId, key, operatorId: access.user.userId});
    return NextResponse.json({deleted: key, userId}, {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'DELETE /api/admin/accounts/[id]/settings/[key]', '用户特例清除失败，请稍后重试。');
  }
}
