import {NextResponse} from 'next/server';
import {CircleError} from '@/lib/circles/errors';
import {manageCircleMember} from '@/lib/circles/membership-management';
import {jsonError, privateHeaders, requireAdminUser, unauthorized} from '@/lib/http';

export async function PATCH(request: Request, {params}: {params: Promise<{id: string; userId: string}>}) {
  try {
    const actor = await requireAdminUser(request);
    if (!actor) return unauthorized();
    let input: unknown;
    try { input = await request.json(); } catch { throw new CircleError('成员管理数据格式错误。'); }
    const target = await params;
    return NextResponse.json(await manageCircleMember(actor.userId, target.id, target.userId, input), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'PATCH /api/admin/circles/[id]/members/[userId]', '圈子操作失败，请稍后重试。');
  }
}
