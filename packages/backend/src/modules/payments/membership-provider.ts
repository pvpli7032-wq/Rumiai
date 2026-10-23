import { createEzfpCheckout, formatCnyCents, getPublicSiteOrigin, parseCnyCents, uniqueUrlParams, verifyEzfpParams } from './ezfp-v2';
import { requestEzfpRefund } from './ezfp-refund';
import type { PaymentRuntimeConfiguration } from './merchant-config-service';

/**
 * Payment-provider boundary for memberships.
 *
 * Membership state/order ownership lives in the memberships module.  This
 * file deliberately contains only EZFP transport, callback authentication,
 * and refund transport; it must not grant a membership or
 * mutate coins.
 */

export class MembershipPaymentError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string) {
    super(message);
    this.name = 'MembershipPaymentError';
  }
}

export type MembershipCheckoutInput = {
  orderNo: string;
  amountCnyCents: number;
  planName: string;
  paymentMethod: 'alipay' | 'wxpay';
  clientIp: string;
  notifyPath: string;
  returnPath: string;
  config: PaymentRuntimeConfiguration;
};

function assertAmount(amountCnyCents: number): void {
  if (!Number.isSafeInteger(amountCnyCents) || amountCnyCents < 1) {
    throw new MembershipPaymentError('会员套餐金额配置无效。', 400, 'INVALID_AMOUNT');
  }
}

function safePath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || /[\r\n]/.test(path)) {
    throw new MembershipPaymentError('支付回调路径无效。', 500, 'INVALID_CALLBACK_PATH');
  }
  return path;
}

/** Build an EZFP checkout URL without making any membership/account changes. */
export async function createMembershipEzfpCheckout(input: MembershipCheckoutInput) {
  assertAmount(input.amountCnyCents);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.orderNo)) {
    throw new MembershipPaymentError('会员订单号格式无效。', 400, 'INVALID_ORDER');
  }
  if (!input.planName.trim() || input.planName.length > 120) {
    throw new MembershipPaymentError('会员套餐名称无效。', 400, 'INVALID_PLAN');
  }
  const origin = getPublicSiteOrigin(process.env);
  const checkout = await createEzfpCheckout({
    pid: input.config.pid,
    method: 'jump',
    type: input.paymentMethod,
    out_trade_no: input.orderNo,
    notify_url: `${origin}${safePath(input.notifyPath)}`,
    return_url: `${origin}${safePath(input.returnPath)}?payment=${encodeURIComponent(input.orderNo)}`,
    name: `会员套餐 ${input.planName.trim()}`,
    money: formatCnyCents(input.amountCnyCents),
    clientip: input.clientIp,
    timestamp: String(Math.floor(Date.now() / 1000)),
  }, {
    ...process.env,
    EZFP_ENABLED: 'true',
    EZFP_PID: input.config.pid,
    EZFP_MERCHANT_PRIVATE_KEY: input.config.privateKey,
    EZFP_PLATFORM_PUBLIC_KEY: input.config.publicKey,
    EZFP_API_BASE_URL: input.config.baseUrl,
  });
  return { ...checkout, amountCnyCents: input.amountCnyCents, orderNo: input.orderNo };
}

export type MembershipCallback = {
  orderNo: string;
  tradeNo: string;
  amountCnyCents: number;
  pid: string;
};

/** Authenticate and normalize an EZFP callback. It does not settle an order. */
export function verifyMembershipEzfpCallback(
  callbackUrl: string,
  config: PaymentRuntimeConfiguration,
  expected?: { orderNo?: string; amountCnyCents?: number },
): MembershipCallback {
  let url: URL;
  try { url = new URL(callbackUrl); } catch { throw new MembershipPaymentError('支付通知地址无效。', 400, 'INVALID_CALLBACK'); }
  const params = uniqueUrlParams(url);
  if (!params || !params.out_trade_no || !params.trade_no || !params.money) {
    throw new MembershipPaymentError('支付通知缺少必要字段。', 400, 'MISSING_CALLBACK_FIELDS');
  }
  if (params.sign_type !== 'RSA' || !/^\d{10}$/.test(params.timestamp || '') || !verifyEzfpParams(params, config.publicKey)) {
    throw new MembershipPaymentError('支付通知验签失败。', 400, 'INVALID_SIGNATURE');
  }
  const amountCnyCents = parseCnyCents(params.money);
  if (params.pid !== config.pid || params.trade_status !== 'TRADE_SUCCESS' || !amountCnyCents) {
    throw new MembershipPaymentError('支付通知状态无效。', 400, 'INVALID_PAYMENT_STATUS');
  }
  if (expected?.orderNo && expected.orderNo !== params.out_trade_no) throw new MembershipPaymentError('支付订单号不匹配。', 409, 'ORDER_MISMATCH');
  if (expected?.amountCnyCents !== undefined && expected.amountCnyCents !== amountCnyCents) throw new MembershipPaymentError('支付金额不匹配。', 409, 'AMOUNT_MISMATCH');
  return { orderNo: params.out_trade_no, tradeNo: params.trade_no, amountCnyCents, pid: params.pid };
}

/** Execute only the provider side of a previously approved membership refund. */
export async function requestMembershipEzfpRefund(input: {
  tradeNo: string;
  refundNo: string;
  refundAmountCnyCents: number;
  config: PaymentRuntimeConfiguration;
}) {
  assertAmount(input.refundAmountCnyCents);
  return requestEzfpRefund(input.tradeNo, input.refundNo, input.refundAmountCnyCents, input.config);
}
