import {NextResponse} from 'next/server';
import {getFinanceAdmin} from '@/lib/payments/finance-auth';
import {listPaymentOrders} from '@/lib/payments/order-management-service';
import {apiError, jsonError, privateHeaders} from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const access = await getFinanceAdmin(request);
  if (!access.user) return apiError(access.status, access.error);
  const params = new URL(request.url).searchParams;
  try {
    const result = await listPaymentOrders({page: params.get('page') ?? undefined, pageSize: params.get('pageSize') ?? undefined, status: params.get('status') ?? undefined, query: params.get('q') ?? undefined, from: params.get('from') ?? undefined, until: params.get('until') ?? undefined});
    return NextResponse.json(result, {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/finance/orders/all', '订单列表加载失败。');
  }
}
