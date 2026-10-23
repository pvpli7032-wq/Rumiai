import { randomBytes } from 'node:crypto';
import { db } from '@rumiai/backend/infrastructure/database/client';
import { readPurchasablePackage } from '@rumiai/backend/modules/coins/package-service';
import { createEzfpCheckout, formatCnyCents, getPublicSiteOrigin } from './ezfp-v2';
import {resolveNewPaymentConfiguration} from './merchant-config-service';

export class PaymentOrderError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = 'PaymentOrderError'; }
}

export async function getUserPaymentOrderStatus(userId: string, orderNo: string) {
  return db.paymentOrder.findFirst({
    where: { orderNo, userId },
    select: { orderNo: true, status: true, amountCnyCents: true, coinAmount: true, createdAt: true, paidAt: true },
  });
}

function newOrderNumber(): string {
  return `KH${Date.now().toString(36).toUpperCase()}${randomBytes(8).toString('hex').toUpperCase()}`;
}

function existingOrderResult(order: {
  orderNo: string; status: string; providerPayInfo: string | null; packageId: string | null;
}, packageId: string) {
  if (order.packageId !== packageId) throw new PaymentOrderError('该请求编号已用于其他套餐。', 409);
  if (order.status === 'PAID') return { orderNo: order.orderNo, status: order.status };
  if (order.status === 'PENDING' && order.providerPayInfo) {
    return { orderNo: order.orderNo, status: order.status, redirectUrl: order.providerPayInfo };
  }
  throw new PaymentOrderError('订单仍在处理中，请稍后查询订单状态。', 409);
}

export async function createCoinPaymentOrder(input: {
  userId: string;
  packageId: string;
  idempotencyKey: string;
  clientIp: string;
  paymentMethod?: unknown;
  quote?: { amountCnyCents: number; coinAmount: number };
}) {
  const paymentMethod = input.paymentMethod ?? 'alipay';
  if (paymentMethod !== 'alipay' && paymentMethod !== 'wxpay') throw new PaymentOrderError('不支持该支付方式。', 400);
  // Retry a created order using its original snapshot even after deactivation or expiry.
  const lookup = { where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } } };
  const existing = await db.paymentOrder.findUnique({ ...lookup,
    select: { orderNo: true, status: true, providerPayInfo: true, packageId: true },
  });
  if (existing) return existingOrderResult(existing, input.packageId);
  let paymentConfig;
  try { paymentConfig=await resolveNewPaymentConfiguration(); } catch { paymentConfig=null; }
  if (!paymentConfig) throw new PaymentOrderError('真实支付暂未配置或未启用。', 503);
  const pid = paymentConfig.pid;
  const origin = getPublicSiteOrigin(process.env);
  const pkg = await readPurchasablePackage(input.packageId);
  if (!pkg || !Number.isSafeInteger(pkg.coins) || pkg.coins < 1 || !Number.isSafeInteger(pkg.bonus) || pkg.bonus < 0 || !Number.isSafeInteger(pkg.priceCnyCents) || !pkg.priceCnyCents || pkg.priceCnyCents < 1) {
    throw new PaymentOrderError('该金币套餐尚未配置人民币售价。', 400);
  }
  const coinAmount = pkg.coins + pkg.bonus;
  if (!Number.isSafeInteger(coinAmount) || coinAmount < 1) throw new PaymentOrderError('金币套餐配置无效。', 400);

  if (input.quote && (input.quote.amountCnyCents !== pkg.priceCnyCents || input.quote.coinAmount !== coinAmount)) {
    throw new PaymentOrderError('套餐价格或赠送活动已变化，请刷新后确认新套餐。', 409, 'PACKAGE_CHANGED');
  }

  let order;
  try {
    order = await db.paymentOrder.create({
      data: {
        orderNo: newOrderNumber(),
        idempotencyKey: input.idempotencyKey,
        userId: input.userId,
        packageId: pkg.id,
        packageCoins: pkg.coins,
        packageBonus: pkg.bonus,
        coinAmount,
        amountCnyCents: pkg.priceCnyCents,
        merchantRevisionId:paymentConfig.revisionId,
      },
    });
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2002') {
      const raced = await db.paymentOrder.findUnique({
        ...lookup,
        select: { orderNo: true, status: true, providerPayInfo: true, packageId: true },
      });
      if (raced) return existingOrderResult(raced, pkg.id);
    }
    throw error;
  }

  let checkout;
  try {
    checkout = await createEzfpCheckout({
      pid,
      method: 'jump',
      type: paymentMethod,
      out_trade_no: order.orderNo,
      notify_url: `${origin}/api/coins/payments/ezfp/notify`,
      return_url: `${origin}/shop?payment=${encodeURIComponent(order.orderNo)}`,
      name: `金币充值 ${coinAmount} 枚`,
      money: formatCnyCents(pkg.priceCnyCents),
      clientip: input.clientIp,
      timestamp: String(Math.floor(Date.now() / 1000)),
    }, {...process.env,EZFP_ENABLED:'true',EZFP_PID:paymentConfig.pid,EZFP_MERCHANT_PRIVATE_KEY:paymentConfig.privateKey,EZFP_PLATFORM_PUBLIC_KEY:paymentConfig.publicKey,EZFP_API_BASE_URL:paymentConfig.baseUrl});
  } catch (error) {
    if (error instanceof Error) throw new PaymentOrderError(error.message, 502);
    throw new PaymentOrderError('支付服务调用失败，订单状态待核对。', 502);
  }

  await db.paymentOrder.update({
    where: { id: order.id },
    data: { providerTradeNo: checkout.tradeNo, providerPayType: checkout.payType, providerPayInfo: checkout.payInfo },
  });
  return {
    orderNo: order.orderNo,
    status: 'PENDING',
    amountCnyCents: pkg.priceCnyCents,
    coinAmount,
    redirectUrl: checkout.payInfo,
  };
}
