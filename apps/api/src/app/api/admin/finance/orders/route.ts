import {NextResponse} from 'next/server';
import {getFinanceAdmin} from '@rumiai/backend/modules/payments/finance-auth';
import {listRefundablePaymentOrders} from '@rumiai/backend/modules/payments/refund-service';
import {apiError, badRequest, jsonError, privateHeaders} from '@rumiai/backend/infrastructure/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const access = await getFinanceAdmin(request);
  if (!access.user) return apiError(access.status, access.error);
  const orderNo = new URL(request.url).searchParams.get('orderNo')?.trim();
  if (orderNo && !/^[A-Z0-9]{20,40}$/.test(orderNo)) return badRequest('订单号格式不正确。');
  try {
    return NextResponse.json(await listRefundablePaymentOrders(orderNo, access.user.userId), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/finance/orders', '订单列表加载失败。');
  }
}
