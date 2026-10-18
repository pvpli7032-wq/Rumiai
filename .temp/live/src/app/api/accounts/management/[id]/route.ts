import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {readManagedAccount, updateManagedAccount} from '@/lib/accounts/management-service';
import {accountManagementError, privateHeaders} from '../_response';
type Context = {params: Promise<{id: string}>};
export async function GET(request: Request, context: Context) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    return NextResponse.json(await readManagedAccount(actor.userId, (await context.params).id), {headers: privateHeaders});
  } catch (error) {return accountManagementError(error, 'GET /api/accounts/management/[id]');}
}
export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) return NextResponse.json({error: '请先登录。'}, {status: 401, headers: privateHeaders});
    return NextResponse.json(await updateManagedAccount(actor.userId, (await context.params).id, await request.json().catch(() => null)), {headers: privateHeaders});
  } catch (error) {return accountManagementError(error, 'PATCH /api/accounts/management/[id]');}
}
