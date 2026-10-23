import {NextResponse} from 'next/server';
import {readManagedCharacter, saveManagedCharacter} from '@/lib/characters/management-service';
import {jsonError, privateHeaders, requireAdminUser, unauthorized} from '@/lib/http';

type Context = {params: Promise<{id: string}>};

export async function GET(request: Request, context: Context) {
  try {
    const actor = await requireAdminUser(request);
    if (!actor) return unauthorized();
    return NextResponse.json(await readManagedCharacter(actor.userId, (await context.params).id), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/characters/[id]', '角色管理操作失败，请稍后重试。');
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const actor = await requireAdminUser(request);
    if (!actor) return unauthorized();
    return NextResponse.json(await saveManagedCharacter(actor.userId, (await context.params).id, await request.json().catch(() => null)), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'PUT /api/admin/characters/[id]', '角色管理操作失败，请稍后重试。');
  }
}
