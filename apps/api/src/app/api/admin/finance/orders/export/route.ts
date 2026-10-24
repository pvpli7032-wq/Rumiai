import {getFinanceAdmin} from '@rumiai/backend/modules/payments/finance-auth';
import {exportPaymentOrders} from '@rumiai/backend/modules/payments/order-management-service';
import {apiError, jsonError} from '@rumiai/backend/infrastructure/http';

export const dynamic = 'force-dynamic';

function cell(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function buildPaymentOrdersCsv(rows: Awaited<ReturnType<typeof exportPaymentOrders>>) {
  const header = ['订单号', '订单类型', '会员订单号', '订单状态', '支付渠道', '渠道单号', '币种', '金额分', '套餐金币', '赠送金币', '入账金币', '权益快照JSON', '创建时间', '支付时间', '退款单号', '会员退款记录', '退款状态', '退款金额分'];
  const records = rows.map(order => [
    order.orderNo, order.orderType, order.membershipOrder?.orderNo ?? '', order.status, order.provider, order.providerTradeNo, order.currency,
    order.amountCnyCents, order.packageCoins, order.packageBonus, order.coinAmount, order.packageBenefitsJson,
    order.createdAt.toISOString(), order.paidAt?.toISOString() ?? '', order.refund?.refundNo ?? '', order.refund?.membershipRefundId ?? '', order.refund?.status ?? '', order.refund?.amountCnyCents ?? '',
  ]);
  return '\uFEFF' + [header, ...records].map(row => row.map(cell).join(',')).join('\r\n');
}

export async function GET(request: Request) {
  const access = await getFinanceAdmin(request);
  if (!access.user) return apiError(access.status, access.error);
  const params = new URL(request.url).searchParams;
  try {
    const rows = await exportPaymentOrders({status: params.get('status') ?? undefined, query: params.get('q') ?? undefined});
    const csv = buildPaymentOrdersCsv(rows);
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
