import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {SETTINGS, readSettings, readUserQuota, saveUserOverrides} from '@/lib/settings';
import {badRequest, forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@/lib/http';
import {readSettingsJson, settingsErrorResponse} from '@/app/api/admin/settings/_response';
import {parseOverrideChanges} from '@/app/api/admin/settings/_input';

export const dynamic = 'force-dynamic';

type Context = {params: Promise<{id: string}>};
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const OVERRIDABLE = SETTINGS.filter(def => def.userOverridable);

async function readTargetUser(rawId: string) {
  const userId = decodeURIComponent(rawId);
  if (!ID_PATTERN.test(userId)) return null;
  const user = await db.user.findUnique({where: {id: userId}, select: {id: true, deletedAt: true}});
  return user && !user.deletedAt ? user : null;
}

/** 用户特例：只列出允许按用户覆盖的项，未设特例的显示公共值并标 source=GLOBAL/DEFAULT。 */
export async function GET(request: Request, context: Context) {
  const access = await requireAdmin(request, 'accounts.settings.manage');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备用户额度设置权限的管理员可以查看用户特例。');
  try {
    const user = await readTargetUser((await context.params).id);
    if (!user) return NextResponse.json({error: '账号不存在或已注销。', code: 'NOT_FOUND'}, {status: 404, headers: privateHeaders});
    const base = await readSettings(OVERRIDABLE.map(def => def.key));
    return NextResponse.json({userId: user.id, values: await readUserQuota(user.id, base), definitions: OVERRIDABLE}, {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/accounts/[id]/settings', '用户特例读取失败，请稍后重试。');
  }
}

/** 保存用户特例；到期时间可空，到期后读取自动回落公共值。 */
export async function PUT(request: Request, context: Context) {
  const access = await requireAdmin(request, 'accounts.settings.manage');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备用户额度设置权限的管理员可以修改用户特例。');
  const body = await readSettingsJson(request);
  if (body.response) return body.response;
  try {
    const user = await readTargetUser((await context.params).id);
    if (!user) return NextResponse.json({error: '账号不存在或已注销。', code: 'NOT_FOUND'}, {status: 404, headers: privateHeaders});
    const input = body.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return badRequest('用户特例数据格式不正确。');
    const changes = parseOverrideChanges((input as {changes?: unknown}).changes);
    const result = await saveUserOverrides({userId: user.id, changes, operatorId: access.user.userId});
    return NextResponse.json(result, {headers: privateHeaders});
  } catch (error) {
    return settingsErrorResponse(error, 'PUT /api/admin/accounts/[id]/settings');
  }
}
