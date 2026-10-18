import {NextResponse} from 'next/server';
import {publishManagedCharacter} from '@/lib/characters/management-service';
import {jsonError, privateHeaders, requireUser, unauthorized} from '@/lib/http';

export async function POST(request: Request, context: {params: Promise<{id: string}>}) {
  try {
    const actor = await requireUser(request);
    if (!actor) return unauthorized();
    return NextResponse.json(await publishManagedCharacter(actor.userId, (await context.params).id, await request.json().catch(() => null)), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'POST /api/admin/characters/[id]/publication', '角色管理操作失败，请稍后重试。');
  }
}
