import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {CircleError} from '@/lib/circles/errors';
import {listManagedCircles, saveManagedCircle} from '@/lib/circles/management-service';
import {circleError, privateHeaders} from '@/app/api/circles/_response';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    const q = new URL(request.url).searchParams;
    return NextResponse.json(await listManagedCircles(actor.userId, {q: q.get('q') ?? '', status: q.get('status') ?? 'ALL', ownership: q.get('ownership') ?? 'ALL', featured: q.get('featured') ?? 'ALL', page: Number(q.get('page') ?? 1)}), {headers: privateHeaders});
  } catch (error) {return circleError(error, 'GET /api/admin/circles');}
}
export async function POST(request: Request) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    let input: unknown;
    try {input = await request.json();} catch {throw new CircleError('圈子管理数据格式错误。');}
    return NextResponse.json(await saveManagedCircle(actor.userId, null, input), {status: 201, headers: privateHeaders});
  } catch (error) {return circleError(error, 'POST /api/admin/circles');}
}
