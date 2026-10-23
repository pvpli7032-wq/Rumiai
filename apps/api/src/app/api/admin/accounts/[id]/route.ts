import {NextResponse} from 'next/server';
import {readManagedAccount, updateManagedAccount} from '@rumiai/backend/modules/accounts/management-service';
import {jsonError, privateHeaders, requireAdminUser, unauthorized} from '@rumiai/backend/infrastructure/http';

type Context = {params: Promise<{id: string}>};

export async function GET(request: Request, context: Context) {
  try {
    const actor = await requireAdminUser(request);
    if (!actor) return unauthorized();
    return NextResponse.json(await readManagedAccount(actor.userId, (await context.params).id), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/accounts/[id]', '用户管理操作失败，请稍后重试。');
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await requireAdminUser(request);
    if (!actor) return unauthorized();
    return NextResponse.json(await updateManagedAccount(actor.userId, (await context.params).id, await request.json().catch(() => null)), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'PATCH /api/admin/accounts/[id]', '用户管理操作失败，请稍后重试。');
  }
}
