import {NextResponse} from 'next/server';
import {CircleError} from '@/lib/circles/errors';
import {listManagedCircles, saveManagedCircle} from '@/lib/circles/management-service';
import {jsonError, privateHeaders, requireAdminUser, unauthorized} from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const actor = await requireAdminUser(request);
    if (!actor) return unauthorized();
    const q = new URL(request.url).searchParams;
    return NextResponse.json(await listManagedCircles(actor.userId, {q: q.get('q') ?? '', status: q.get('status') ?? 'ALL', ownership: q.get('ownership') ?? 'ALL', featured: q.get('featured') ?? 'ALL', page: Number(q.get('page') ?? 1)}), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/circles', '圈子操作失败，请稍后重试。');
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdminUser(request);
    if (!actor) return unauthorized();
    let input: unknown;
    try { input = await request.json(); } catch { throw new CircleError('圈子管理数据格式错误。'); }
    return NextResponse.json(await saveManagedCircle(actor.userId, null, input), {status: 201, headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'POST /api/admin/circles', '圈子操作失败，请稍后重试。');
  }
}
