import {NextResponse} from 'next/server';
import {listManagedCircleMembers} from '@rumiai/backend/modules/circles/membership-management';
import {jsonError, privateHeaders, requireAdminUser, unauthorized} from '@rumiai/backend/infrastructure/http';

export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const actor = await requireAdminUser(request);
    if (!actor) return unauthorized();
    const q = new URL(request.url).searchParams;
    return NextResponse.json(await listManagedCircleMembers(actor.userId, (await params).id, {q: q.get('q') ?? '', status: q.get('status') ?? 'MEMBER', page: Number(q.get('page') ?? 1)}), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/circles/[id]/members', '圈子操作失败，请稍后重试。');
  }
}
