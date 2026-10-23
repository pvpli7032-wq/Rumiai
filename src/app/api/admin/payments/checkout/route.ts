import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@/lib/admin-auth/request';
import {logRouteError} from '@/lib/logger';
import {CheckoutPolicyError, readCheckoutPolicy, saveCheckoutPolicy} from '@/lib/payments/checkout-policy-service';

export const dynamic = 'force-dynamic';
const headers = {'Cache-Control': 'private, no-store'};
function failure(error: unknown) {
  if (error instanceof CheckoutPolicyError) return NextResponse.json({error: error.message}, {status: error.status, headers});
  logRouteError('/api/admin/payments/checkout', error);
  return NextResponse.json({error: '充值设置操作失败。'}, {status: 500, headers});
}
export async function GET(request: Request) {
  try {
    const auth = await getAdminRequestUser(request);
    if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401, headers});
    return NextResponse.json(await readCheckoutPolicy(auth.userId), {headers});
  } catch (error) {return failure(error);}
}
export async function PUT(request: Request) {
  try {
    const auth = await getAdminRequestUser(request);
    if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401, headers});
    let input: unknown;
    try {input = await request.json();} catch {return NextResponse.json({error: '请求数据格式不正确。'}, {status: 400, headers});}
    return NextResponse.json(await saveCheckoutPolicy(auth.userId, input), {headers});
  } catch (error) {return failure(error);}
}
