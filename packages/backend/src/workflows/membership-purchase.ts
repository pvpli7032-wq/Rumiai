import { randomBytes } from 'node:crypto';
import { db, pragmasReady } from '@rumiai/backend/infrastructure/database/client';
import { resolveNewPaymentConfiguration, resolveOrderPaymentConfiguration, type PaymentRuntimeConfiguration } from '@rumiai/backend/modules/payments/merchant-config-service';
import { createMembershipEzfpCheckout, requestMembershipEzfpRefund, verifyMembershipEzfpCallback } from '@rumiai/backend/modules/payments/membership-provider';
import { createMembershipOrder, completeMembershipRefund, markMembershipPaidInTransaction, requestMembershipRefund } from '../modules/memberships/service';
import { isCheckoutEnabled } from '../modules/payments/checkout-policy-service';

export class MembershipPaymentWorkflowError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string) { super(message); this.name = 'MembershipPaymentWorkflowError'; }
}

function orderNumber() { return `KM${Date.now().toString(36).toUpperCase()}${randomBytes(8).toString('hex').toUpperCase()}`; }
function validIdempotency(value: unknown) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new MembershipPaymentWorkflowError('请求编号无效。', 400, 'INVALID_IDEMPOTENCY'); return value; }
function method(value: unknown): 'alipay' | 'wxpay' { if (value !== 'alipay' && value !== 'wxpay') throw new MembershipPaymentWorkflowError('不支持该支付方式。', 400, 'INVALID_PAYMENT_METHOD'); return value; }

/** Create a server-priced membership order and an EZFP checkout redirect. */
export async function createMembershipPayment(input: { userId: string; planCode: string; idempotencyKey: string; paymentMethod?: unknown; clientIp: string }) {
  await pragmasReady;
  const idempotencyKey = validIdempotency(input.idempotencyKey);
  const paymentMethod = method(input.paymentMethod ?? 'alipay');
  const existing = await db.membershipOrder.findUnique({ where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey } }, include: { paymentOrder: true, plan: true } });
  if (existing && existing.plan.code !== input.planCode.trim().toUpperCase()) throw new MembershipPaymentWorkflowError('请求编号已经用于另一会员套餐。', 409, 'IDEMPOTENCY_CONFLICT');
  if (existing?.status === 'PAID') return {orderNo:existing.orderNo,status:'PAID',amountCnyCents:existing.amountCents};
  if (existing && existing.status !== 'PENDING') throw new MembershipPaymentWorkflowError('该会员订单已结束，不能重复支付。', 409, 'ORDER_CLOSED');
  if (!await isCheckoutEnabled()) throw new MembershipPaymentWorkflowError('真实支付暂未配置或未启用。', 503, 'PAYMENT_UNAVAILABLE');
  let newConfig: PaymentRuntimeConfiguration | null = null;
  if (!existing?.paymentOrder) {
    try { newConfig = await resolveNewPaymentConfiguration(); } catch { throw new MembershipPaymentWorkflowError('真实支付暂未配置或未启用。', 503, 'PAYMENT_UNAVAILABLE'); }
    if (!newConfig) throw new MembershipPaymentWorkflowError('真实支付暂未配置或未启用。', 503, 'PAYMENT_UNAVAILABLE');
  }
  const membership = existing ?? await createMembershipOrder({ userId: input.userId, planCode: input.planCode, idempotencyKey, orderNo: orderNumber() });
  const plan = await db.membershipPlan.findUnique({ where: { id: membership.planId } });
  if (!plan) throw new MembershipPaymentWorkflowError('会员套餐记录不存在。', 409, 'PLAN_UNAVAILABLE');
  // Claim the SQLite writer before reading the link. Payment creation and linking
  // commit together; never discover a coin top-up by the user's raw request key.
  const paymentOrder = await db.$transaction(async tx => {
    await tx.membershipOrder.updateMany({where:{id:membership.id,status:'PENDING'},data:{status:'PENDING'}});
    const current=await tx.membershipOrder.findUnique({where:{id:membership.id},include:{paymentOrder:true}});
    if (!current || !['PENDING','PAID'].includes(current.status)) throw new MembershipPaymentWorkflowError('该会员订单已结束。',409,'ORDER_CLOSED');
    if (current.paymentOrder) return current.paymentOrder;
    if (!newConfig) throw new MembershipPaymentWorkflowError('支付配置不可用。',503,'PAYMENT_UNAVAILABLE');
    const created=await tx.paymentOrder.create({data:{orderNo:orderNumber(),idempotencyKey:`membership_${current.id}`,userId:input.userId,packageCoins:0,packageBonus:0,coinAmount:0,amountCnyCents:current.amountCents,merchantRevisionId:newConfig.revisionId}});
    await tx.membershipOrder.update({where:{id:current.id},data:{paymentOrderId:created.id}});
    return created;
  });
  if (paymentOrder.status === 'PAID') return { orderNo: membership.orderNo, status: 'PAID', amountCnyCents: paymentOrder.amountCnyCents };
  if (paymentOrder.status !== 'PENDING') throw new MembershipPaymentWorkflowError('支付订单已结束。',409,'ORDER_CLOSED');
  if (paymentOrder.providerPayInfo) return {orderNo:membership.orderNo,status:'PENDING',amountCnyCents:paymentOrder.amountCnyCents,redirectUrl:paymentOrder.providerPayInfo};
  const config = await resolveOrderPaymentConfiguration(paymentOrder.merchantRevisionId);
  const checkout = await createMembershipEzfpCheckout({ orderNo: paymentOrder.orderNo, amountCnyCents: paymentOrder.amountCnyCents, planName: plan.name, paymentMethod, clientIp: input.clientIp, notifyPath: '/api/memberships/payments/ezfp/notify', returnPath: '/membership', config });
  await db.paymentOrder.update({ where: { id: paymentOrder.id }, data: { providerTradeNo: checkout.tradeNo, providerPayType: checkout.payType, providerPayInfo: checkout.payInfo } });
  return { orderNo: membership.orderNo, paymentOrderNo: paymentOrder.orderNo, status: 'PENDING', amountCnyCents: paymentOrder.amountCnyCents, redirectUrl: checkout.payInfo };
}

/** Verify EZFP and settle the linked membership grant in one database transaction. */
export async function settleMembershipEzfpNotification(callbackUrl: string) {
  await pragmasReady;
  const url = new URL(callbackUrl);
  const orderNo = url.searchParams.get('out_trade_no');
  if (!orderNo) throw new MembershipPaymentWorkflowError('会员支付订单号缺失。', 400, 'ORDER_MISSING');
  const paymentOrder = await db.paymentOrder.findUnique({ where: { orderNo }, include: { membershipOrder: true } });
  if (!paymentOrder?.membershipOrder) throw new MembershipPaymentWorkflowError('会员支付订单不存在。', 404, 'ORDER_NOT_FOUND');
  const config = await resolveOrderPaymentConfiguration(paymentOrder.merchantRevisionId);
  const callback = verifyMembershipEzfpCallback(callbackUrl, config, { orderNo: paymentOrder.orderNo, amountCnyCents: paymentOrder.amountCnyCents });
  return db.$transaction(async tx => {
    const paidAt=new Date();
    const changed=await tx.paymentOrder.updateMany({
      where:{id:paymentOrder.id,status:'PENDING',OR:[{providerTradeNo:null},{providerTradeNo:callback.tradeNo}]},
      data:{status:'PAID',providerTradeNo:callback.tradeNo,paidAt},
    });
    const current = await tx.paymentOrder.findUnique({ where: { id: paymentOrder.id }, include: { membershipOrder: true } });
    if (!current?.membershipOrder) throw new MembershipPaymentWorkflowError('会员支付订单关系异常。', 409, 'ORDER_LINK_INVALID');
    if (changed.count===0 && current.status === 'PAID') {
      if (current.providerTradeNo !== callback.tradeNo) throw new MembershipPaymentWorkflowError('支付交易号冲突。', 409, 'TRADE_MISMATCH');
      await tx.paymentCallbackEvent.create({ data: { paymentOrderId: current.id, provider: 'EZFP', providerTradeNo: callback.tradeNo, outcome: 'DUPLICATE' } });
      return { duplicate: true };
    }
    if (changed.count===0) throw new MembershipPaymentWorkflowError('订单状态或支付交易号不允许入账。', 409, 'ORDER_NOT_PENDING');
    await markMembershipPaidInTransaction(tx, current.membershipOrder.orderNo, paidAt);
    await tx.paymentCallbackEvent.create({ data: { paymentOrderId: current.id, provider: 'EZFP', providerTradeNo: callback.tradeNo, outcome: 'SETTLED' } });
    return { duplicate: false };
  });
}

/** Request and, when the provider confirms, complete one membership refund. */
export async function refundMembershipPayment(userId: string, orderNo: string, reason?: string) {
  await pragmasReady;
  const order = await db.membershipOrder.findFirst({ where: { orderNo, userId }, include: { paymentOrder: true, refund: true } });
  if (!order?.paymentOrder?.providerTradeNo) throw new MembershipPaymentWorkflowError('会员订单不存在或尚未支付。', 404, 'ORDER_NOT_FOUND');
  if (order.refund?.status === 'COMPLETED') return order.refund;
  const config = await resolveOrderPaymentConfiguration(order.paymentOrder.merchantRevisionId);
  if (!config.refundsEnabled) throw new MembershipPaymentWorkflowError('退款功能尚未启用。', 503, 'REFUNDS_DISABLED');
  const refund = order.refund && order.refund.status !== 'FAILED'
    ? order.refund
    : await requestMembershipRefund(orderNo, reason?.trim() || '会员退款');
  if (refund.amountCents === 0) return completeMembershipRefund(orderNo);
  try {
    const result = await requestMembershipEzfpRefund({ tradeNo: order.paymentOrder.providerTradeNo, refundNo: `MR-${refund.id}-${refund.attempt}`, refundAmountCnyCents: refund.amountCents, config });
    if (!result.success) {
      await db.membershipRefund.updateMany({where:{id:refund.id,status:'PENDING',attempt:refund.attempt},data:{status:'FAILED'}});
      throw new MembershipPaymentWorkflowError('支付渠道拒绝退款，会员权益已恢复，可在有效退款窗口内重试。', 502, 'PROVIDER_REJECTED');
    }
    return completeMembershipRefund(orderNo, result.providerRefundNo);
  } catch (error) {
    if (error instanceof MembershipPaymentWorkflowError) throw error;
    throw new MembershipPaymentWorkflowError('支付渠道结果未能确认，会员权益保持不变，请稍后重试。', 502, 'PROVIDER_UNCERTAIN');
  }
}
