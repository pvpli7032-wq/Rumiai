import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {listManagedCircleMembers} from '@/lib/circles/membership-management';
import {circleError, privateHeaders} from '../../../_response';
export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    const q = new URL(request.url).searchParams;
    return NextResponse.json(await listManagedCircleMembers(actor.userId, (await params).id, {q: q.get('q') ?? '', status: q.get('status') ?? 'MEMBER', page: Number(q.get('page') ?? 1)}), {headers: privateHeaders});
  } catch (error) {return circleError(error, 'GET /api/circles/management/[id]/members');}
}
