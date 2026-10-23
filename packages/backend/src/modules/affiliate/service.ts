import type {Prisma} from '@prisma/client';
import {db} from '@rumiai/backend/infrastructure/database/client';
import {SETTINGS_BY_KEY} from '@rumiai/contracts/settings/registry';
import {parseStoredValue} from '@rumiai/contracts/settings/validation';

export const AFFILIATE_ORDER_TYPES = ['COIN', 'MEMBERSHIP'] as const;
export type AffiliateOrderType = typeof AFFILIATE_ORDER_TYPES[number];

export class AffiliateError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'AFFILIATE_INVALID') {super(message); this.name = 'AffiliateError';}
}

export async function readAffiliatePolicy(tx: Prisma.TransactionClient = db) {
  const keys = ['affiliate.enabled', 'affiliate.commissionPercent', 'affiliate.eligibleOrderTypes', 'affiliate.settlementDelayHours', 'affiliate.minimumWithdrawalCents'] as const;
  const rows = await tx.operationSetting.findMany({where: {key: {in: [...keys]}}});
  const values = Object.fromEntries(keys.map(key => {const row = rows.find(item => item.key === key), def = SETTINGS_BY_KEY[key]; return [key, row ? parseStoredValue(def, row.value) : def.default];}));
  const percent = typeof values['affiliate.commissionPercent'] === 'number' ? values['affiliate.commissionPercent'] : null;
  const rawTypes = values['affiliate.eligibleOrderTypes'];
  const eligibleOrderTypes = Array.isArray(rawTypes) && rawTypes.every(item => typeof item === 'string' && AFFILIATE_ORDER_TYPES.includes(item as AffiliateOrderType)) ? [...new Set(rawTypes)] as AffiliateOrderType[] : [];
  const commissionBps = percent !== null && Number.isInteger(percent * 100) ? percent * 100 : null;
  return {enabled: values['affiliate.enabled'] === true, commissionPercent: percent, commissionBps, eligibleOrderTypes, settlementDelayHours: typeof values['affiliate.settlementDelayHours'] === 'number' ? values['affiliate.settlementDelayHours'] : null, minimumWithdrawalCents: typeof values['affiliate.minimumWithdrawalCents'] === 'number' ? values['affiliate.minimumWithdrawalCents'] : null, currency: 'CNY'};
}

/** Payment-domain port: direct relationship only, policy snapshot, exactly one row per order. */
export async function recordAffiliateOrderPaidInTransaction(tx: Prisma.TransactionClient, input: {sourceType: AffiliateOrderType; sourceOrderId: string; buyerId: string; amountCents: number; currency: string; paidAt?: Date}) {
  const prior = await tx.affiliateAccrual.findUnique({where: {sourceType_sourceOrderId: {sourceType: input.sourceType, sourceOrderId: input.sourceOrderId}}});
  if (prior) return prior;
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1) throw new AffiliateError('佣金订单金额无效。');
  const policy = await readAffiliatePolicy(tx);
  if (!policy.enabled || policy.commissionBps === null || policy.settlementDelayHours === null || policy.minimumWithdrawalCents === null || !policy.eligibleOrderTypes.includes(input.sourceType) || policy.currency !== input.currency) return null;
  const relation = await tx.referralRelationship.findUnique({where: {inviteeId: input.buyerId}});
  if (!relation) return null; // Relationship is never applied retroactively.
  const paidAt = input.paidAt ?? new Date();
  const commissionCents = Math.floor(input.amountCents * policy.commissionBps / 10_000);
  if (commissionCents < 1) return null;
  try {
    return await tx.affiliateAccrual.create({data: {sourceType: input.sourceType, sourceOrderId: input.sourceOrderId, beneficiaryUserId: relation.inviterId, referredUserId: input.buyerId, relationshipId: relation.id, baseAmountCents: input.amountCents, commissionBps: policy.commissionBps, commissionCents, currency: input.currency, availableAt: new Date(paidAt.getTime() + policy.settlementDelayHours * 3_600_000)}});
  } catch (error) {
    if (typeof error === 'object' && error && (error as {code?: string}).code === 'P2002') return tx.affiliateAccrual.findUnique({where: {sourceType_sourceOrderId: {sourceType: input.sourceType, sourceOrderId: input.sourceOrderId}}});
    throw error;
  }
}

/** Idempotent cumulative proportional reversal; partial and full refunds share one rule. */
export async function recordAffiliateRefundInTransaction(tx: Prisma.TransactionClient, input: {sourceType: AffiliateOrderType; sourceOrderId: string; refundKey: string; refundAmountCents: number}) {
  const duplicate = await tx.affiliateReversal.findUnique({where: {refundKey: input.refundKey}});
  if (duplicate) return duplicate;
  const accrual = await tx.affiliateAccrual.findUnique({where: {sourceType_sourceOrderId: {sourceType: input.sourceType, sourceOrderId: input.sourceOrderId}}});
  if (!accrual) return null;
  if (!Number.isSafeInteger(input.refundAmountCents) || input.refundAmountCents < 1 || accrual.refundedBaseCents + input.refundAmountCents > accrual.baseAmountCents) throw new AffiliateError('退款冲回金额无效。');
  const cumulativeBase = accrual.refundedBaseCents + input.refundAmountCents;
  const targetReversal = Math.floor(accrual.commissionCents * cumulativeBase / accrual.baseAmountCents);
  const delta = targetReversal - accrual.reversedCents;
  const reversal = await tx.affiliateReversal.create({data: {accrualId: accrual.id, refundKey: input.refundKey, refundBaseAmountCents: input.refundAmountCents, reversedCommissionCents: delta}});
  await tx.affiliateAccrual.update({where: {id: accrual.id}, data: {refundedBaseCents: cumulativeBase, reversedCents: targetReversal, ...(cumulativeBase === accrual.baseAmountCents ? {status: 'REVERSED'} : {})}});
  return reversal;
}

export async function listAffiliateLedger(input: {beneficiaryUserId?: string; status?: string; page?: number}) {
  const page = input.page ?? 1;
  if (!Number.isSafeInteger(page) || page < 1 || (input.status && !['PENDING', 'AVAILABLE', 'PROCESSED', 'REVERSED'].includes(input.status))) throw new AffiliateError('佣金查询条件无效。');
  const now = new Date();
  const statusWhere: Prisma.AffiliateAccrualWhereInput = input.status === 'AVAILABLE'
    ? {OR: [{status: 'AVAILABLE'}, {status: 'PENDING', availableAt: {lte: now}}]}
    : input.status === 'PENDING'
      ? {status: 'PENDING', availableAt: {gt: now}}
      : input.status ? {status: input.status} : {};
  const where: Prisma.AffiliateAccrualWhereInput = {...(input.beneficiaryUserId ? {beneficiaryUserId: input.beneficiaryUserId} : {}), ...statusWhere};
  const [rows, total] = await db.$transaction([db.affiliateAccrual.findMany({where, include: {beneficiary: {select: {username: true, email: true}}, referredUser: {select: {username: true, email: true}}, reversals: true}, orderBy: {createdAt: 'desc'}, take: 50, skip: (page - 1) * 50}), db.affiliateAccrual.count({where})]);
  const items = rows.map(item => item.status === 'PENDING' && item.availableAt <= now ? {...item, status: 'AVAILABLE'} : item);
  return {items, total, page, pageSize: 50};
}
