import { NextResponse } from 'next/server';
import { getFinanceAdmin } from '@/lib/payments/finance-auth';
import { listRefundablePaymentOrders } from '@/lib/payments/refund-service';
import { logRouteError } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const access = await getFinanceAdmin(request);
  if (!access.user) return NextResponse.json({ error: access.error }, { status: access.status });
  const orderNo = new URL(request.url).searchParams.get('orderNo')?.trim();
  if (orderNo && !/^[A-Z0-9]{20,40}$/.test(orderNo)) return NextResponse.json({ error: '订单号格式不正确。' }, { status: 400 });
  try { return NextResponse.json(await listRefundablePaymentOrders(orderNo), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { logRouteError('GET /api/finance/orders', error); return NextResponse.json({ error: '订单列表加载失败。' }, { status: 500 }); }
}
