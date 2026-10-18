import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {CircleError} from '@/lib/circles/errors';
import {manageCircleMember} from '@/lib/circles/membership-management';
import {circleError, privateHeaders} from '../../../../_response';
export async function PATCH(request: Request, {params}: {params: Promise<{id: string; userId: string}>}) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    let input: unknown;
    try {input = await request.json();} catch {throw new CircleError('成员管理数据格式错误。');}
    const target = await params;
    return NextResponse.json(await manageCircleMember(actor.userId, target.id, target.userId, input), {headers: privateHeaders});
  } catch (error) {return circleError(error, 'PATCH /api/circles/management/[id]/members/[userId]');}
}
