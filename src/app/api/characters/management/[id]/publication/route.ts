import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {publishManagedCharacter} from '@/lib/characters/management-service';
import {managementError, privateHeaders} from '../../_response';
export async function POST(request: Request, context: {params: Promise<{id: string}>}) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    return NextResponse.json(await publishManagedCharacter(actor.userId, (await context.params).id, await request.json().catch(() => null)), {headers: privateHeaders});
  } catch (error) {return managementError(error, 'POST /api/characters/management/[id]/publication');}
}
