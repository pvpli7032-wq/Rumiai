import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {listManagedAccounts} from '@/lib/accounts/management-service';
import {accountManagementError, privateHeaders} from './_response';
export async function GET(request: Request) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await listManagedAccounts(actor.userId, {q: params.get('q') ?? '', status: params.get('status') ?? 'ALL', community: params.get('community') ?? 'ALL', sort: params.get('sort') ?? 'NEWEST', page: Number(params.get('page') ?? 1)}), {headers: privateHeaders});
  } catch (error) {return accountManagementError(error, 'GET /api/accounts/management');}
}
