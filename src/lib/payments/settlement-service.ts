import { db } from '@/lib/db';
import { formatCnyCents, uniqueUrlParams, verifyEzfpParams } from './ezfp-v2';

export class PaymentNotificationError extends Error {
  constructor(message: string, readonly reason: string, readonly status = 400) {
    super(message);
    this.name = 'PaymentNotificationError';
  }
}

function reject(reason: string, status = 400): never {
  throw new PaymentNotificationError('支付通知验证失败。', reason, status);
}

export async function settleEzfpNotification(callbackUrl: string): Promise<{ duplicate: boolean }> {
  const params = uniqueUrlParams(new URL(callbackUrl));
  const publicKey = process.env.EZFP_PLATFORM_PUBLIC_KEY;
  const pid = process.env.EZFP_PID?.trim();
  if (!params) reject('duplicate_fields');
  if (!publicKey || !pid) reject('provider_config_missing', 503);
  if (params.sign_type !== 'RSA' || !/^\d{10}$/.test(params.timestamp || '') || !verifyEzfpParams(params, publicKey)) {
    reject('signature_or_timestamp');
  }
  if (params.pid !== pid || params.trade_status !== 'TRADE_SUCCESS' || !params.out_trade_no || !params.trade_no || !params.money) {
    reject('required_fields_or_status');
  }

  const order = await db.paymentOrder.findUnique({ where: { orderNo: params.out_trade_no } });
  if (!order || order.provider !== 'EZFP' || order.currency !== 'CNY') reject('order_not_found');
  if (params.money !== formatCnyCents(order.amountCnyCents)) reject('amount_mismatch');
  if (order.providerTradeNo && order.providerTradeNo !== params.trade_no) reject('provider_order_mismatch');
  if (order.status === 'PAID') {
    if (order.providerTradeNo === params.trade_no) return { duplicate: true };
    reject('paid_order_trade_mismatch');
  }
  if (order.status !== 'PENDING') reject('order_not_pending');

  const settled = await db.$transaction(async (tx) => {
    const changed = await tx.paymentOrder.updateMany({
      where: { id: order.id, status: 'PENDING' },
      data: { status: 'PAID', providerTradeNo: params.trade_no, paidAt: new Date() },
    });
    if (changed.count === 0) {
      const current = await tx.paymentOrder.findUnique({ where: { id: order.id }, select: { status: true, providerTradeNo: true } });
      if (current?.status === 'PAID' && current.providerTradeNo === params.trade_no) return false;
      throw new Error('Payment order state changed before settlement');
    }
    await tx.user.update({ where: { id: order.userId }, data: { coins: { increment: order.coinAmount } } });
    await tx.coinTransaction.create({
      data: {
        userId: order.userId,
        paymentOrderId: order.id,
        amount: order.coinAmount,
        type: 'PURCHASE',
        description: `EZFP 充值订单 ${order.orderNo}`,
      },
    });
    return true;
  });

  return { duplicate: !settled };
}
