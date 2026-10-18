import {NextResponse} from 'next/server';
import {listManagedCharacters, saveManagedCharacter} from '@/lib/characters/management-service';
import {jsonError, privateHeaders, requireUser, unauthorized} from '@/lib/http';

export async function GET(request: Request) {
  try {
    const actor = await requireUser(request);
    if (!actor) return unauthorized();
    const p = new URL(request.url).searchParams;
    return NextResponse.json(await listManagedCharacters(actor.userId, {q: p.get('q') ?? '', status: p.get('status') ?? 'ALL', tag: p.get('tag') ?? '', creatorId: p.get('creatorId') ?? '', page: Number(p.get('page') ?? 1)}), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/characters', '角色管理操作失败，请稍后重试。');
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireUser(request);
    if (!actor) return unauthorized();
    return NextResponse.json(await saveManagedCharacter(actor.userId, null, await request.json().catch(() => null)), {status: 201, headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'POST /api/admin/characters', '角色管理操作失败，请稍后重试。');
  }
}
