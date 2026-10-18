import {NextResponse} from 'next/server';
import {listManagedAccounts} from '@/lib/accounts/management-service';
import {jsonError, privateHeaders, requireUser, unauthorized} from '@/lib/http';

export async function GET(request: Request) {
  try {
    const actor = await requireUser(request);
    if (!actor) return unauthorized();
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await listManagedAccounts(actor.userId, {q: params.get('q') ?? '', status: params.get('status') ?? 'ALL', community: params.get('community') ?? 'ALL', sort: params.get('sort') ?? 'NEWEST', page: Number(params.get('page') ?? 1)}), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/accounts', '用户管理操作失败，请稍后重试。');
  }
}
