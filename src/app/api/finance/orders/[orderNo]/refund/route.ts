import { NextResponse } from 'next/server';
import { getFinanceAdmin } from '@/lib/payments/finance-auth';
import { PaymentRefundError, submitFullPaymentRefund, verifyPaymentRefund } from '@/lib/payments/refund-service';
import { logRouteError } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ orderNo: string }> }) {
  const access = await getFinanceAdmin(request);
  if (!access.user) return NextResponse.json({ error: access.error }, { status: access.status });
  const orderNo = (await context.params).orderNo;
  if (!/^[A-Z0-9]{20,40}$/.test(orderNo)) return NextResponse.json({ error: '订单号格式不正确。' }, { status: 400 });
  try {
    const body = await request.json().catch(() => null);
    if (body?.action === 'verify') return NextResponse.json(await verifyPaymentRefund(orderNo), { headers: { 'Cache-Control': 'private, no-store' } });
    if (!['refund', 'retry'].includes(body?.action)) return NextResponse.json({ error: '操作不正确。' }, { status: 400 });
    const result = await submitFullPaymentRefund(orderNo, access.user.userId, body.reason);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof PaymentRefundError) return NextResponse.json({ error: error.message }, { status: error.status });
    logRouteError('POST /api/finance/orders/[orderNo]/refund', error);
    return NextResponse.json({ error: '退款操作失败，请查看订单状态。' }, { status: 500 });
  }
}
