import { randomBytes } from 'node:crypto';
import { db, pragmasReady } from '@/lib/db';
import { requestEzfpRefund, verifyEzfpFullRefund, RefundProviderUncertain } from './ezfp-refund';
import { isEzfpConfigured } from './ezfp-v2';

export class PaymentRefundError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'PaymentRefundError'; }
}

const publicState = (refund: { refundNo: string; status: string; amountCnyCents: number; coinAmount: number; errorCode: string | null; createdAt: Date; completedAt: Date | null }) => ({
  refundNo: refund.refundNo, status: refund.status, amountCnyCents: refund.amountCnyCents,
  coinAmount: refund.coinAmount, errorCode: refund.errorCode, createdAt: refund.createdAt, completedAt: refund.completedAt,
});

export async function listRefundablePaymentOrders(orderNo?: string) {
  await pragmasReady;
  const rows = await db.paymentOrder.findMany({
    where: { ...(orderNo ? { orderNo } : {}), provider: 'EZFP', currency: 'CNY', status: { in: ['PAID', 'REFUND_PENDING', 'REFUNDED'] } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: orderNo ? 1 : 30,
    select: { orderNo: true, provider: true, providerTradeNo: true, currency: true, status: true, amountCnyCents: true, coinAmount: true, paidAt: true, refund: { select: { refundNo: true, status: true, amountCnyCents: true, coinAmount: true, errorCode: true, createdAt: true, completedAt: true } } },
  });
  return rows.map(({ refund, ...order }) => ({ ...order, refund: refund ? publicState(refund) : null }));
}

function refundNo() { return `KRF${Date.now().toString(36).toUpperCase()}${randomBytes(8).toString('hex').toUpperCase()}`; }

async function completeRefund(refundId: string, providerRefundNo: string | null) {
  return db.$transaction(async tx => {
    const refund = await tx.paymentRefund.findUnique({ where: { id: refundId } });
    if (!refund) throw new PaymentRefundError('退款记录不存在。', 404);
    if (refund.status === 'SUCCEEDED') return refund;
    if (!['PROCESSING', 'UNKNOWN'].includes(refund.status)) throw new PaymentRefundError('退款状态已结束，不能重复处理。', 409);
    const completed = await tx.paymentRefund.update({ where: { id: refund.id }, data: { status: 'SUCCEEDED', providerRefundNo, errorCode: null, completedAt: new Date() } });
    const changed = await tx.paymentOrder.updateMany({ where: { id: refund.paymentOrderId, status: 'REFUND_PENDING' }, data: { status: 'REFUNDED' } });
    if (!changed.count) throw new PaymentRefundError('订单状态与退款记录不一致，请核对账目。', 409);
    return completed;
  });
}

async function failAndRelease(refundId: string) {
  return db.$transaction(async tx => {
    const refund = await tx.paymentRefund.findUnique({ where: { id: refundId }, include: { paymentOrder: true } });
    if (!refund) throw new PaymentRefundError('退款记录不存在。', 404);
    if (refund.status === 'FAILED') return refund;
    if (refund.status !== 'PROCESSING') throw new PaymentRefundError('退款结果仍待核实，金币继续冻结。', 409);
    await tx.paymentRefund.update({ where: { id: refund.id }, data: { status: 'FAILED', errorCode: 'provider_rejected', completedAt: new Date() } });
    const changed = await tx.paymentOrder.updateMany({ where: { id: refund.paymentOrderId, status: 'REFUND_PENDING' }, data: { status: 'PAID' } });
    if (!changed.count) throw new PaymentRefundError('订单状态与退款记录不一致，请核对账目。', 409);
    await tx.user.update({ where: { id: refund.paymentOrder.userId }, data: { coins: { increment: refund.coinAmount } } });
    await tx.coinTransaction.create({ data: { userId: refund.paymentOrder.userId, refundReleaseId: refund.id, amount: refund.coinAmount, type: 'REFUND_RELEASE', description: `退款未成功，返还预留金币 ${refund.paymentOrder.orderNo}` } });
    return refund;
  });
}

async function reserve(orderNo: string, actorId: string, reason: string) {
  return db.$transaction(async tx => {
    const order = await tx.paymentOrder.findUnique({ where: { orderNo }, include: { coinTransaction: true, refund: true } });
    if (!order) throw new PaymentRefundError('订单不存在。', 404);
    if (order.refund) return { refund: order.refund, created: false };
    if (order.status !== 'PAID' || order.provider !== 'EZFP' || order.currency !== 'CNY' || !order.providerTradeNo) throw new PaymentRefundError('只有已确认到账的 EZFP 人民币订单可申请退款。', 409);
    const original = order.coinTransaction;
    if (!original || original.userId !== order.userId || original.amount !== order.coinAmount || original.type !== 'PURCHASE') throw new PaymentRefundError('充值流水异常，已阻止退款，请先核对账目。', 409);
    const refund = await tx.paymentRefund.create({ data: { paymentOrderId: order.id, refundNo: refundNo(), actorId, reason, amountCnyCents: order.amountCnyCents, coinAmount: order.coinAmount } });
    const balance = await tx.user.updateMany({ where: { id: order.userId, coins: { gte: order.coinAmount } }, data: { coins: { decrement: order.coinAmount } } });
    if (!balance.count) throw new PaymentRefundError('账号可用金币不足，未向支付渠道发起退款。', 409);
    const state = await tx.paymentOrder.updateMany({ where: { id: order.id, status: 'PAID' }, data: { status: 'REFUND_PENDING' } });
    if (!state.count) throw new PaymentRefundError('订单状态已变化，请刷新后重试。', 409);
    await tx.coinTransaction.create({ data: { userId: order.userId, refundId: refund.id, amount: -order.coinAmount, type: 'REFUND', description: `退款预留金币 ${order.orderNo}` } });
    return { refund, created: true, order };
  });
}

async function setUnknown(refundId: string, errorCode: string) {
  return db.paymentRefund.updateMany({ where: { id: refundId, status: 'PROCESSING' }, data: { status: 'UNKNOWN', errorCode, attemptedAt: new Date() } });
}

export async function submitFullPaymentRefund(orderNo: string, actorId: string, reasonInput: unknown) {
  if (process.env.EZFP_REFUNDS_ENABLED !== 'true' || !isEzfpConfigured(process.env)) throw new PaymentRefundError('退款功能尚未启用或渠道配置不完整。', 503);
  await pragmasReady;
  const existing = await db.paymentOrder.findUnique({ where: { orderNo }, select: { refund: { select: { refundNo: true, status: true, amountCnyCents: true, coinAmount: true, errorCode: true, createdAt: true, completedAt: true } } } });
  if (!existing) throw new PaymentRefundError('订单不存在。', 404);
  if (existing.refund?.status === 'SUCCEEDED') {
    return publicState(existing.refund);
  }
  if (typeof reasonInput !== 'string' || !reasonInput.trim() || reasonInput.trim().length > 500) throw new PaymentRefundError('请填写 1–500 字的退款原因。', 400);
  const prepared = await reserve(orderNo, actorId, reasonInput.trim());
  if (prepared.refund.status === 'SUCCEEDED') return publicState(prepared.refund);
  if (prepared.refund.status === 'FAILED') throw new PaymentRefundError('该订单退款申请已被渠道拒绝，金币已返还；请查明原因后再处理。', 409);
  if (!prepared.created && prepared.refund.status === 'PROCESSING' && Date.now() - prepared.refund.attemptedAt.getTime() < 60000) throw new PaymentRefundError('该退款正在处理，请稍后查询退款状态。', 409);
  if (!prepared.created && !['UNKNOWN', 'PROCESSING'].includes(prepared.refund.status)) throw new PaymentRefundError('该退款不能再次发起。', 409);
  if (!prepared.created) {
    const claimed = await db.paymentRefund.updateMany({ where: { id: prepared.refund.id, status: prepared.refund.status, attemptedAt: prepared.refund.attemptedAt }, data: { status: 'PROCESSING', attemptedAt: new Date(), errorCode: null } });
    if (!claimed.count) throw new PaymentRefundError('该退款已被另一请求接管，请刷新状态。', 409);
  }
  const order = await db.paymentOrder.findUniqueOrThrow({ where: { orderNo } });
  try {
    const result = await requestEzfpRefund(order.providerTradeNo!, prepared.refund.refundNo, prepared.refund.amountCnyCents);
    if (!result.success) { await failAndRelease(prepared.refund.id); throw new PaymentRefundError('支付渠道拒绝退款，预留金币已返还。', 502); }
    return publicState(await completeRefund(prepared.refund.id, result.providerRefundNo));
  } catch (error) {
    if (error instanceof PaymentRefundError) throw error;
    const code = error instanceof RefundProviderUncertain ? error.message : 'provider_unexpected_result';
    await setUnknown(prepared.refund.id, code);
    throw new PaymentRefundError('支付渠道结果未能确认，金币暂时冻结。请查询状态后使用同一退款单号重试。', 502);
  }
}

export async function verifyPaymentRefund(orderNo: string) {
  const order = await db.paymentOrder.findUnique({ where: { orderNo }, include: { refund: true } });
  if (!order?.refund) throw new PaymentRefundError('找不到该订单的退款记录。', 404);
  if (order.refund.status === 'SUCCEEDED' || order.refund.status === 'FAILED') return publicState(order.refund);
  try {
    const refunded = await verifyEzfpFullRefund(order.providerTradeNo!, order.orderNo, order.amountCnyCents);
    if (refunded) return publicState(await completeRefund(order.refund.id, order.refund.providerRefundNo));
    await db.paymentRefund.updateMany({ where: { id: order.refund.id, status: { in: ['PROCESSING', 'UNKNOWN'] } }, data: { status: 'UNKNOWN', errorCode: 'provider_still_paid' } });
    return { ...publicState({ ...order.refund, status: 'UNKNOWN', errorCode: 'provider_still_paid' }), errorCode: 'provider_still_paid' };
  } catch (error) {
    if (error instanceof RefundProviderUncertain) return { ...publicState(order.refund), errorCode: error.message };
    throw error;
  }
}
