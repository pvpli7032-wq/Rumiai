import {NextResponse} from 'next/server';
import {CircleError} from '@rumiai/backend/modules/circles/errors';
import {readManagedCircle, saveManagedCircle} from '@rumiai/backend/modules/circles/management-service';
import {jsonError, privateHeaders, requireAdminUser, unauthorized} from '@rumiai/backend/infrastructure/http';

type Context = {params: Promise<{id: string}>};

export async function GET(request: Request, {params}: Context) {
  try {
    const actor = await requireAdminUser(request);
    if (!actor) return unauthorized();
    return NextResponse.json(await readManagedCircle(actor.userId, (await params).id), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/circles/[id]', '圈子操作失败，请稍后重试。');
  }
}

export async function PATCH(request: Request, {params}: Context) {
  try {
    const actor = await requireAdminUser(request);
    if (!actor) return unauthorized();
    let input: unknown;
    try { input = await request.json(); } catch { throw new CircleError('圈子管理数据格式错误。'); }
    return NextResponse.json(await saveManagedCircle(actor.userId, (await params).id, input), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'PATCH /api/admin/circles/[id]', '圈子操作失败，请稍后重试。');
  }
}
