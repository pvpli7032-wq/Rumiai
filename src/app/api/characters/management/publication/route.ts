import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {publishManagedCharacters} from '@/lib/characters/management-service';
import {managementError, privateHeaders} from '../_response';
export async function POST(request: Request) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    const results = await publishManagedCharacters(actor.userId, await request.json().catch(() => null));
    return NextResponse.json({items: results.map(character => ({id: character.id, status: character.reviewStatus, isPublic: character.isPublic, updatedAt: character.updatedAt}))}, {headers: privateHeaders});
  } catch (error) {return managementError(error, 'POST /api/characters/management/publication');}
}
