import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {readManagedCharacter, saveManagedCharacter} from '@/lib/characters/management-service';
import {managementError, privateHeaders} from '../_response';
type Context = {params: Promise<{id: string}>};
export async function GET(request: Request, context: Context) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    return NextResponse.json(await readManagedCharacter(actor.userId, (await context.params).id), {headers: privateHeaders});
  } catch (error) {return managementError(error, 'GET /api/admin/characters/[id]');}
}
export async function PUT(request: Request, context: Context) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    return NextResponse.json(await saveManagedCharacter(actor.userId, (await context.params).id, await request.json().catch(() => null)), {headers: privateHeaders});
  } catch (error) {return managementError(error, 'PUT /api/admin/characters/[id]');}
}
