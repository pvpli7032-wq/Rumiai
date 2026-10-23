import {NextResponse} from 'next/server';
import {readManagedCharacterModels, saveManagedCharacterModels} from '@rumiai/backend/modules/characters/model-access-service';
import {jsonError, privateHeaders, requireAdminUser, unauthorized} from '@rumiai/backend/infrastructure/http';

type Context = {params: Promise<{id: string}>};

export async function GET(request: Request, context: Context) {
  try {
    const actor = await requireAdminUser(request);
    if (!actor) return unauthorized();
    return NextResponse.json(await readManagedCharacterModels(actor.userId, (await context.params).id), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/characters/[id]/models', '角色管理操作失败，请稍后重试。');
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const actor = await requireAdminUser(request);
    if (!actor) return unauthorized();
    return NextResponse.json(await saveManagedCharacterModels(actor.userId, (await context.params).id, await request.json().catch(() => null)), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'PUT /api/admin/characters/[id]/models', '角色管理操作失败，请稍后重试。');
  }
}
