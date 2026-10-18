import {NextResponse} from 'next/server';
import {getFinanceAdmin} from '@/lib/payments/finance-auth';
import {requestFullPaymentRefund, approveFullPaymentRefund, rejectFullPaymentRefund, retryFullPaymentRefund, verifyPaymentRefund} from '@/lib/payments/refund-service';
import {apiError, badRequest, jsonError, privateHeaders} from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: {params: Promise<{orderNo: string}>}) {
  const orderNo = (await context.params).orderNo;
  if (!/^[A-Z0-9]{20,40}$/.test(orderNo)) return badRequest('订单号格式不正确。');
  try {
    const body = await request.json().catch(() => null);
    const action = body?.action;
    const permission = action === 'request' || action === 'refund' ? 'finance.refunds.request' : action === 'approve' || action === 'reject' ? 'finance.refunds.approve' : action === 'verify' || action === 'retry' ? 'finance.refunds.execute' : null;
    if (!permission) return badRequest('操作不正确。');
    const access = await getFinanceAdmin(request, permission);
    if (!access.user) return apiError(access.status, access.error);
    if (action === 'verify') return NextResponse.json(await verifyPaymentRefund(orderNo), {headers: privateHeaders});
    if (action === 'approve') return NextResponse.json(await approveFullPaymentRefund(orderNo, access.user.userId, body.reason), {headers: privateHeaders});
    if (action === 'reject') return NextResponse.json(await rejectFullPaymentRefund(orderNo, access.user.userId, body.reason), {headers: privateHeaders});
    if (action === 'retry') return NextResponse.json(await retryFullPaymentRefund(orderNo, access.user.userId), {headers: privateHeaders});
    const result = await requestFullPaymentRefund(orderNo, access.user.userId, body.reason);
    return NextResponse.json(result, {status: 201, headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'POST /api/admin/finance/orders/[orderNo]/refund', '退款操作失败，请查看订单状态。');
  }
}
