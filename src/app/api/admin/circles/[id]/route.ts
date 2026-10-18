import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {CircleError} from '@/lib/circles/errors';
import {readManagedCircle, saveManagedCircle} from '@/lib/circles/management-service';
import {circleError, privateHeaders} from '@/app/api/circles/_response';
type Context = {params: Promise<{id: string}>};
export async function GET(request: Request, {params}: Context) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    return NextResponse.json(await readManagedCircle(actor.userId, (await params).id), {headers: privateHeaders});
  } catch (error) {return circleError(error, 'GET /api/admin/circles/[id]');}
}
export async function PATCH(request: Request, {params}: Context) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    let input: unknown;
    try {input = await request.json();} catch {throw new CircleError('圈子管理数据格式错误。');}
    return NextResponse.json(await saveManagedCircle(actor.userId, (await params).id, input), {headers: privateHeaders});
  } catch (error) {return circleError(error, 'PATCH /api/admin/circles/[id]');}
}
