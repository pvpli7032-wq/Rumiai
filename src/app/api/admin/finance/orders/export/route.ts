import {getFinanceAdmin} from '@/lib/payments/finance-auth';
import {exportPaymentOrders} from '@/lib/payments/order-management-service';
import {apiError, jsonError} from '@/lib/http';

export const dynamic = 'force-dynamic';

function cell(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export async function GET(request: Request) {
  const access = await getFinanceAdmin(request);
  if (!access.user) return apiError(access.status, access.error);
  const params = new URL(request.url).searchParams;
  try {
    const rows = await exportPaymentOrders({status: params.get('status') ?? undefined, query: params.get('q') ?? undefined});
    const header = ['订单号', '订单状态', '支付渠道', '渠道单号', '币种', '金额分', '套餐金币', '赠送金币', '入账金币', '创建时间', '支付时间', '退款单号', '退款状态'];
    const records = rows.map(order => [
      order.orderNo, order.status, order.provider, order.providerTradeNo, order.currency,
      order.amountCnyCents, order.packageCoins, order.packageBonus, order.coinAmount,
      order.createdAt.toISOString(), order.paidAt?.toISOString() ?? '', order.refund?.refundNo ?? '', order.refund?.status ?? '',
    ]);
    const csv = '\uFEFF' + [header, ...records].map(row => row.map(cell).join(',')).join('\r\n');
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return new Response(csv, {headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="payment-orders-${date}.csv"`,
      'Cache-Control': 'private, no-store',
    }});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/finance/orders/export', '订单导出失败。');
  }
}
