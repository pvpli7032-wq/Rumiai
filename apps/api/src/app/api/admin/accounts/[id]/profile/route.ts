import {NextResponse} from 'next/server';
import {readManagedProfile, updateManagedProfile} from '@rumiai/backend/modules/accounts/admin-profile-service';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized, readJsonBody} from '@rumiai/backend/infrastructure/http';

type Context = {params: Promise<{id: string}>};

export async function GET(request: Request, context: Context) {
  const access = await requireAdmin(request, 'accounts.read');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('当前账号没有用户管理查看权限。');
  try {
    return NextResponse.json(await readManagedProfile(access.user.userId, (await context.params).id), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/accounts/[id]/profile', '用户资料读取失败，请稍后重试。');
  }
}

export async function PATCH(request: Request, context: Context) {
  const access = await requireAdmin(request, 'accounts.manage');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('当前账号没有用户资料修改权限。');
  try {
    const body = await readJsonBody(request);
    if (body.response) return body.response;
    return NextResponse.json(await updateManagedProfile(access.user.userId, (await context.params).id, body.input), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'PATCH /api/admin/accounts/[id]/profile', '用户资料修改失败，请稍后重试。');
  }
}
