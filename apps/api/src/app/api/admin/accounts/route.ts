import {NextResponse} from 'next/server';
import {createManagedAccount, listManagedAccounts} from '@rumiai/backend/modules/accounts/management-service';
import {jsonError, privateHeaders, requireAdminUser, unauthorized} from '@rumiai/backend/infrastructure/http';

export async function GET(request: Request) {
  try {
    const actor = await requireAdminUser(request);
    if (!actor) return unauthorized();
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await listManagedAccounts(actor.userId, {q: params.get('q') ?? '', status: params.get('status') ?? 'ALL', community: params.get('community') ?? 'ALL', sort: params.get('sort') ?? 'NEWEST', page: Number(params.get('page') ?? 1), from: params.get('from') ?? '', until: params.get('until') ?? ''}), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/accounts', '用户管理操作失败，请稍后重试。');
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdminUser(request); if (!actor) return unauthorized();
    return NextResponse.json(await createManagedAccount(actor.userId, await request.json().catch(() => null)), {status: 201, headers: privateHeaders});
  } catch (error) { return jsonError(error, 'POST /api/admin/accounts', '账号创建失败。'); }
}
