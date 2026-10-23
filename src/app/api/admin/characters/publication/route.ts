import {NextResponse} from 'next/server';
import {publishManagedCharacters} from '@/lib/characters/management-service';
import {jsonError, privateHeaders, requireAdminUser, unauthorized} from '@/lib/http';

export async function POST(request: Request) {
  try {
    const actor = await requireAdminUser(request);
    if (!actor) return unauthorized();
    const results = await publishManagedCharacters(actor.userId, await request.json().catch(() => null));
    return NextResponse.json({items: results.map(character => ({id: character.id, status: character.reviewStatus, isPublic: character.isPublic, updatedAt: character.updatedAt}))}, {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'POST /api/admin/characters/publication', '角色管理操作失败，请稍后重试。');
  }
}
