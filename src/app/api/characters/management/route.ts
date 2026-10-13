import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {listManagedCharacters, saveManagedCharacter} from '@/lib/characters/management-service';
import {managementError, privateHeaders} from './_response';
export async function GET(request: Request) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    const p = new URL(request.url).searchParams;
    return NextResponse.json(await listManagedCharacters(actor.userId, {q: p.get('q') ?? '', status: p.get('status') ?? 'ALL', tag: p.get('tag') ?? '', creatorId: p.get('creatorId') ?? '', page: Number(p.get('page') ?? 1)}), {headers: privateHeaders});
  } catch (error) {return managementError(error, 'GET /api/characters/management');}
}
export async function POST(request: Request) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    return NextResponse.json(await saveManagedCharacter(actor.userId, null, await request.json().catch(() => null)), {status: 201, headers: privateHeaders});
  } catch (error) {return managementError(error, 'POST /api/characters/management');}
}
