import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {hasAdminPermission} from '@rumiai/backend/modules/admin/authorization';
import {recordAdminAudit} from '@rumiai/backend/modules/admin/management-service';
import {readSettingValue} from '@rumiai/backend/modules/settings/service';
import {MEMBERSHIP_BENEFIT_RULES, MEMBERSHIP_BENEFIT_DEFINITIONS, type MembershipBenefitDefinition, type MembershipUsagePage, type MembershipBenefit, type MembershipBenefitKey, type MembershipPlanPublic, type MembershipPolicyPublic, type MembershipRefundQuote} from '@rumiai/contracts/memberships';
import type {MembershipCurrent} from '@rumiai/contracts/memberships';
import type {AdminAccountMembershipOrder, AdminAccountMembershipUsage} from '@rumiai/contracts/admin/account-assets';
import {recordAffiliateOrderPaidInTransaction, recordAffiliateRefundInTransaction} from '@rumiai/backend/modules/affiliate/service';

const DEFAULT_POLICY = {refundWindowHours: 24, usageChargePeriodHours: 24};
/** Only these codes are executable by the product. Unknown codes are rejected at write time. */
export const SUPPORTED_BENEFIT_CODES = new Set(Object.keys(MEMBERSHIP_BENEFIT_RULES));

export class MembershipError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string) { super(message); this.name = 'MembershipError'; }
}
export type MembershipUsageState = 'RESERVED' | 'CONSUMED' | 'RELEASED';

function benefits(value: unknown): MembershipBenefit[] {
  if (!Array.isArray(value) || value.length > 100) throw new MembershipError('会员权益格式无效。');
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new MembershipError('会员权益格式无效。');
    const row = item as Record<string, unknown>;
    if (typeof row.key !== 'string' || !SUPPORTED_BENEFIT_CODES.has(row.key) || typeof row.label !== 'string' || !row.label.trim() || row.label.length > 120) throw new MembershipError('会员权益编号或名称无效，只支持已接入的会员权益。');
    if (seen.has(row.key)) throw new MembershipError('同一套餐不能重复配置同一项会员权益。');
    seen.add(row.key);
    if (typeof row.value !== 'number' || !Number.isFinite(row.value)) throw new MembershipError('会员权益值必须为有效数字。');
    const rule = MEMBERSHIP_BENEFIT_RULES[row.key as MembershipBenefitKey];
    if (row.value < rule.min || row.value > rule.max || rule.kind === 'integer' && !Number.isSafeInteger(row.value)) throw new MembershipError(`会员权益 ${row.key} 的数值范围或精度无效。`);
    return {key: row.key as MembershipBenefitKey, label: row.label.trim(), value: row.value} as MembershipBenefit;
  });
}

function parseBenefits(json: string): MembershipBenefit[] {
  try { return benefits(JSON.parse(json)); } catch { return []; }
}

/** Pure validation surface used by admin transport tests before a transactional save. */
export function validateMembershipBenefits(value: unknown): MembershipBenefit[] {
  return benefits(value);
}

function publicPlan(row: {id: string; code: string; name: string; durationDays: number; priceCents: number | null; benefitsJson: string; isActive: boolean; sortOrder: number; version: number}): MembershipPlanPublic {
  return {id: row.id, code: row.code, name: row.name, durationDays: row.durationDays, priceCents: row.priceCents, benefits: parseBenefits(row.benefitsJson), isActive: row.isActive, sortOrder: row.sortOrder, version: row.version};
}

export async function readMembershipCatalogue(): Promise<{plans: MembershipPlanPublic[]; policy: MembershipPolicyPublic; benefitDefinitions: MembershipBenefitDefinition[]}> {
  await pragmasReady;
  const [plans, policy] = await Promise.all([db.membershipPlan.findMany({orderBy: [{sortOrder: 'asc'}, {createdAt: 'asc'}]}), db.membershipPolicy.findUnique({where: {id: 'primary'}})]);
  return {plans: plans.map(publicPlan), benefitDefinitions: MEMBERSHIP_BENEFIT_DEFINITIONS, policy: {refundWindowHours: policy?.refundWindowHours ?? DEFAULT_POLICY.refundWindowHours, usageChargePeriodHours: policy?.usageChargePeriodHours ?? DEFAULT_POLICY.usageChargePeriodHours, version: policy?.version ?? 0}};
}

/** Current paid grant for the signed-in frontend; expired/revoked grants stay hidden. */
export async function readMembershipCurrent(userId: string, now = new Date()): Promise<MembershipCurrent> {
  await pragmasReady;
  const grants = await db.membershipGrant.findMany({where: {userId, status: 'ACTIVE', expiresAt: {gt: now}}, orderBy: {expiresAt: 'desc'}, include: {order: {include: {plan: true}}}});
  const grant = grants.find(row => row.startsAt <= now);
  if (!grant) return null;
  const renewalExpiresAt = grants.reduce((latest, row) => row.expiresAt > latest ? row.expiresAt : latest, grant.expiresAt);
  return {orderNo: grant.order.orderNo, planCode: grant.order.plan.code, startsAt: grant.startsAt.toISOString(), expiresAt: grant.expiresAt.toISOString(), renewalExpiresAt: renewalExpiresAt.toISOString(), benefits: parseBenefits(grant.benefitsJson)};
}

export async function readMembershipOrders(userId: string) {
  await pragmasReady;
  const orders = await db.membershipOrder.findMany({where: {userId}, orderBy: {createdAt: 'desc'}, take: 50, include: {plan: true, refund: true, grant: true}});
  return orders.map(order => ({orderNo: order.orderNo, planCode: order.plan.code, planName: order.plan.name, amountCents: order.amountCents, durationDays: order.durationDays, status: order.status, paidAt: order.paidAt?.toISOString() ?? null, createdAt: order.createdAt.toISOString(), grant: order.grant ? {startsAt: order.grant.startsAt.toISOString(), expiresAt: order.grant.expiresAt.toISOString(), status: order.grant.status} : null, refund: order.refund ? {status: order.refund.status, amountCents: order.refund.amountCents, deductedCents: order.refund.deductedCents} : null}));
}

/** Account-management projection: membership owns its order/grant/usage rules. */
export async function readMembershipAccountAssets(userId: string): Promise<{current: MembershipCurrent; orders: AdminAccountMembershipOrder[]}> {
  const [current, orders, orderRows, grouped] = await Promise.all([
    readMembershipCurrent(userId),
    readMembershipOrders(userId),
    db.membershipOrder.findMany({where: {userId}, select: {id: true, orderNo: true}}),
    db.membershipUsage.groupBy({where: {userId}, by: ['orderId', 'state'], _sum: {quantity: true}}),
  ]);
  const orderIdByNo = new Map(orderRows.map(row => [row.orderNo, row.id]));
  const usageByOrder = new Map<string, AdminAccountMembershipUsage>();
  for (const row of grouped) {
    const summary = usageByOrder.get(row.orderId) ?? {consumed: 0, reserved: 0, released: 0};
    const quantity = row._sum.quantity ?? 0;
    if (row.state === 'CONSUMED') summary.consumed = quantity;
    else if (row.state === 'RESERVED') summary.reserved = quantity;
    else if (row.state === 'RELEASED') summary.released = quantity;
    usageByOrder.set(row.orderId, summary);
  }
  return {
    current,
    orders: orders.map(order => ({...order, amountCents: order.amountCents, usage: usageByOrder.get(orderIdByNo.get(order.orderNo) ?? '') ?? {consumed: 0, reserved: 0, released: 0}})),
  };
}

export async function readMembershipBenefit(userId: string, benefitCode: string): Promise<{orderNo: string; value: number} | null> {
  if (!SUPPORTED_BENEFIT_CODES.has(benefitCode)) return null;
  await pragmasReady;
  const now = new Date();
  const grant = await db.membershipGrant.findFirst({where: {userId, status: 'ACTIVE', startsAt: {lte: now}, expiresAt: {gt: now}}, orderBy: {expiresAt: 'desc'}, include: {order: {include: {refund: true}}}});
  if (!grant) return null;
  if (grant.order.refund && grant.order.refund.status !== 'FAILED') return null;
  const item = parseBenefits(grant.benefitsJson).find(row => row.key === benefitCode);
  if (!item || typeof item.value !== 'number' || !Number.isFinite(item.value) || item.value < 0) return null;
  return {orderNo: grant.order.orderNo, value: item.value};
}

async function requireFinance(actorId: string, tx: Prisma.TransactionClient = db) {
  if (!await hasAdminPermission(actorId, 'finance.packages.write', tx)) throw new MembershipError('当前账号没有会员套餐配置权限。', 403);
}

function reason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 300) throw new MembershipError('请填写 1–300 字操作理由。');
  return value.trim();
}

function validDuration(code: string, days: number) {
  if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(code) || !Number.isSafeInteger(days) || days < 1 || days > 3660) throw new MembershipError('会员套餐编号或时长无效。');
  if (code === 'MONTHLY' && days !== 30) throw new MembershipError('月会员时长固定为 30 个 24 小时周期。');
}

/** Atomic admin write. A null price deliberately leaves a plan unavailable for purchase. */
export async function saveMembershipPlan(actorId: string, input: {id?: string; code: string; name: string; durationDays: number; priceCents: number | null; benefits: unknown; isActive: boolean; sortOrder?: number; version?: number; reason: string}) {
  const code = input.code.trim().toUpperCase();
  if (!input.name.trim() || input.name.trim().length > 80 || typeof input.isActive !== 'boolean') throw new MembershipError('会员套餐名称或状态无效。');
  validDuration(code, input.durationDays);
  if (input.priceCents !== null && (!Number.isSafeInteger(input.priceCents) || input.priceCents < 1)) throw new MembershipError('会员价格必须为正整数；未定价请留空。');
  const parsedBenefits = benefits(input.benefits);
  const characterLimitBenefit = parsedBenefits.find(item => item.key === 'CHARACTER_CREATE_LIMIT');
  if (characterLimitBenefit) {
    const publicCap = await readSettingValue<number>('content.character.maxOwned');
    if (publicCap <= 0 || characterLimitBenefit.value <= publicCap) throw new MembershipError('角色总上限权益需要先配置大于 0 的公共角色上限，且会员总上限必须高于公共上限。');
  }
  if (!Number.isSafeInteger(input.sortOrder ?? 0) || (input.sortOrder ?? 0) < 0) throw new MembershipError('排序值无效。');
  const explanation = reason(input.reason);
  await pragmasReady;
  return db.$transaction(async tx => {
    await requireFinance(actorId, tx);
    const before = input.id ? await tx.membershipPlan.findUnique({where: {id: input.id}}) : null;
    if (input.id && !before) throw new MembershipError('会员套餐不存在。', 404);
    if (before && input.version !== before.version) throw new MembershipError('会员套餐已被其他人修改，请刷新。', 409, 'VERSION_CONFLICT');
    const saved = before ? await tx.membershipPlan.update({where: {id: before.id}, data: {code, name: input.name.trim(), durationDays: input.durationDays, priceCents: input.priceCents, benefitsJson: JSON.stringify(parsedBenefits), isActive: input.isActive, sortOrder: input.sortOrder ?? 0, version: {increment: 1}}}) : await tx.membershipPlan.create({data: {code, name: input.name.trim(), durationDays: input.durationDays, priceCents: input.priceCents, benefitsJson: JSON.stringify(parsedBenefits), isActive: input.isActive, sortOrder: input.sortOrder ?? 0, version: 1}});
    await recordAdminAudit(tx, actorId, before ? 'UPDATE_MEMBERSHIP_PLAN' : 'CREATE_MEMBERSHIP_PLAN', saved.id, explanation, {before: before ? publicPlan(before) : null, after: publicPlan(saved)});
    return publicPlan(saved);
  });
}

/** Only an inactive, never-purchased plan can be removed; historical snapshots remain protected. */
export async function deleteMembershipPlan(actorId: string, input: {id: string; version: number; reason: string}) {
  const explanation = reason(input.reason);
  if (!input.id || !Number.isSafeInteger(input.version)) throw new MembershipError('会员套餐删除参数无效。');
  return db.$transaction(async tx => {
    await requireFinance(actorId, tx);
    const plan = await tx.membershipPlan.findUnique({where: {id: input.id}, include: {_count: {select: {orders: true}}}});
    if (!plan) throw new MembershipError('会员套餐不存在。', 404);
    if (plan.version !== input.version) throw new MembershipError('会员套餐已被其他人修改，请刷新。', 409, 'VERSION_CONFLICT');
    if (plan.isActive) throw new MembershipError('请先停用套餐再删除。', 409, 'PLAN_ACTIVE');
    if (plan._count.orders) throw new MembershipError('该套餐已有订单快照，必须保留历史记录。', 409, 'PLAN_REFERENCED');
    await tx.membershipPlan.delete({where: {id: plan.id}});
    await recordAdminAudit(tx, actorId, 'DELETE_MEMBERSHIP_PLAN', plan.id, explanation, {before: publicPlan(plan), orders: plan._count.orders});
    return {id: plan.id, deleted: true};
  });
}

export async function saveMembershipPolicy(actorId: string, input: {refundWindowHours: number; usageChargePeriodHours: number; version: number; reason: string}) {
  if (!Number.isSafeInteger(input.refundWindowHours) || input.refundWindowHours < 1 || input.refundWindowHours > 168 || !Number.isSafeInteger(input.usageChargePeriodHours) || input.usageChargePeriodHours < 1 || input.usageChargePeriodHours > 24 * 30) throw new MembershipError('会员退款参数无效。');
  const explanation = reason(input.reason);
  return db.$transaction(async tx => {
    await requireFinance(actorId, tx);
    const before = await tx.membershipPolicy.findUnique({where: {id: 'primary'}});
    if ((before?.version ?? 0) !== input.version) throw new MembershipError('会员退款参数已被其他人修改，请刷新。', 409, 'VERSION_CONFLICT');
    const saved = await tx.membershipPolicy.upsert({where: {id: 'primary'}, update: {refundWindowHours: input.refundWindowHours, usageChargePeriodHours: input.usageChargePeriodHours, version: {increment: 1}}, create: {id: 'primary', refundWindowHours: input.refundWindowHours, usageChargePeriodHours: input.usageChargePeriodHours, version: 1}});
    await recordAdminAudit(tx, actorId, 'UPDATE_MEMBERSHIP_POLICY', 'primary', explanation, {before, after: saved});
    return {refundWindowHours: saved.refundWindowHours, usageChargePeriodHours: saved.usageChargePeriodHours, version: saved.version};
  });
}

/** Create a priced order snapshot. Payment adapters call markMembershipPaid after provider confirmation. */
export async function createMembershipOrder(input: {userId: string; planCode: string; idempotencyKey: string; orderNo: string; paymentOrderId?: string}) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.idempotencyKey) || !/^[A-Za-z0-9_-]{1,100}$/.test(input.orderNo)) throw new MembershipError('会员订单标识无效。');
  return db.$transaction(async tx => {
    const existing = await tx.membershipOrder.findUnique({where: {userId_idempotencyKey: {userId: input.userId, idempotencyKey: input.idempotencyKey}}, include: {plan: true}});
    if (existing) return existing;
    const [plan, policy] = await Promise.all([tx.membershipPlan.findUnique({where: {code: input.planCode.toUpperCase()}}), tx.membershipPolicy.findUnique({where: {id: 'primary'}})]);
    if (!plan || !plan.isActive || plan.priceCents === null || plan.priceCents < 1) throw new MembershipError('该会员套餐暂未开放购买。', 409, 'PLAN_UNAVAILABLE');
    return tx.membershipOrder.create({data: {orderNo: input.orderNo, userId: input.userId, idempotencyKey: input.idempotencyKey, planId: plan.id, paymentOrderId: input.paymentOrderId, amountCents: plan.priceCents, durationDays: plan.durationDays, refundWindowHours: policy?.refundWindowHours ?? DEFAULT_POLICY.refundWindowHours, usageChargePeriodHours: policy?.usageChargePeriodHours ?? DEFAULT_POLICY.usageChargePeriodHours, benefitsJson: plan.benefitsJson}});
  });
}

/** Provider success hook. Repeated callbacks return the existing grant and never extend twice. */
export async function markMembershipPaidInTransaction(tx: Prisma.TransactionClient, orderNo: string, paidAt = new Date()) {
    const order = await tx.membershipOrder.findUnique({where: {orderNo}, include: {grant: true}});
    if (!order) throw new MembershipError('会员订单不存在。', 404);
    if (order.status === 'PAID' && order.grant) return order.grant;
    if (order.status !== 'PENDING') throw new MembershipError('会员订单当前不可确认支付。', 409);
    const prior = await tx.membershipGrant.findFirst({where: {userId: order.userId, status: 'ACTIVE', expiresAt: {gt: paidAt}}, orderBy: {expiresAt: 'desc'}});
    const startsAt = prior ? prior.expiresAt : paidAt;
    const expiresAt = new Date(startsAt.getTime() + order.durationDays * 86_400_000);
    const grant = await tx.membershipGrant.create({data: {orderId: order.id, userId: order.userId, startsAt, expiresAt, benefitsJson: order.benefitsJson}});
    await tx.membershipOrder.update({where: {id: order.id}, data: {status: 'PAID', paidAt}});
    await recordAffiliateOrderPaidInTransaction(tx, {sourceType: 'MEMBERSHIP', sourceOrderId: order.id, buyerId: order.userId, amountCents: order.amountCents, currency: 'CNY', paidAt});
    return grant;
}

export async function markMembershipPaid(orderNo: string, paidAt = new Date()) {
  return db.$transaction(tx => markMembershipPaidInTransaction(tx, orderNo, paidAt));
}

export async function recordMembershipUsageInTransaction(tx: Prisma.TransactionClient, input: {orderNo: string; userId: string; benefitCode: string; idempotencyKey: string; quantity?: number; metadata?: unknown; now?: Date; state?: MembershipUsageState; chargeId?: string}) {
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(input.benefitCode) || !/^[A-Za-z0-9_.:-]{1,120}$/.test(input.idempotencyKey)) throw new MembershipError('会员权益使用标识无效。');
  const order = await tx.membershipOrder.findUnique({where: {orderNo: input.orderNo}, include: {grant: true, refund: true}});
    const now = input.now ?? new Date();
    if (!order || order.userId !== input.userId || order.status !== 'PAID' || (order.refund && order.refund.status !== 'FAILED') || !order.grant || order.grant.status !== 'ACTIVE' || order.grant.startsAt > now || order.grant.expiresAt <= now) throw new MembershipError('会员权益当前不可用。', 409, 'MEMBERSHIP_INACTIVE');
  const prior = await tx.membershipUsage.findUnique({where: {idempotencyKey: input.idempotencyKey}});
  if (prior) {
    if (prior.orderId !== order.id || prior.userId !== input.userId || prior.benefitCode !== input.benefitCode) throw new MembershipError('权益使用幂等编号已属于其他业务，不能复用。', 409, 'IDEMPOTENCY_CONFLICT');
    return prior;
  }
  if (!parseBenefits(order.benefitsJson).some(item => item.key === input.benefitCode)) throw new MembershipError('该权益不在订单快照中。', 409, 'BENEFIT_NOT_GRANTED');
  const quantity = input.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new MembershipError('权益使用数量无效。');
  return tx.membershipUsage.create({data: {orderId: order.id, userId: input.userId, benefitCode: input.benefitCode, quantity, state: input.state ?? 'CONSUMED', chargeId: input.chargeId, idempotencyKey: input.idempotencyKey, metadataJson: input.metadata === undefined ? undefined : JSON.stringify(input.metadata)}});
}

export async function recordMembershipUsage(input: {orderNo: string; userId: string; benefitCode: string; idempotencyKey: string; quantity?: number; metadata?: unknown; now?: Date; state?: MembershipUsageState; chargeId?: string}) {
  return db.$transaction(tx => recordMembershipUsageInTransaction(tx, input));
}

/** Billing hold/settle/release transition, keyed by the generation charge id. */
export async function updateMembershipUsageStateInTransaction(tx: Prisma.TransactionClient, input: {chargeId: string; benefitCode: string; state: Exclude<MembershipUsageState, 'RESERVED'>}) {
  const row = await tx.membershipUsage.findUnique({where: {chargeId_benefitCode: {chargeId: input.chargeId, benefitCode: input.benefitCode}}});
  if (!row) return null;
  if (row.state === input.state) return row;
  if (row.state !== 'RESERVED') throw new MembershipError('会员权益消费状态不能重复转换。', 409, 'USAGE_STATE_CONFLICT');
  return tx.membershipUsage.update({where: {id: row.id}, data: {state: input.state}});
}

/** Customer-facing preview must not disclose another account's order or usage. */
export async function quoteMembershipRefundForUser(userId: string, orderNo: string, now = new Date()): Promise<MembershipRefundQuote> {
  await pragmasReady;
  const ownedOrder = await db.membershipOrder.findFirst({where: {orderNo, userId}, select: {id: true}});
  if (!ownedOrder) throw new MembershipError('会员订单不存在。', 404, 'NOT_FOUND');
  return quoteMembershipRefund(orderNo, now);
}

export async function quoteMembershipRefund(orderNo: string, now = new Date()): Promise<MembershipRefundQuote> {
  const order = await db.membershipOrder.findUnique({where: {orderNo}, include: {usage: {select: {id: true, state: true}}, refund: true}});
  if (!order || order.status !== 'PAID' || !order.paidAt) throw new MembershipError('该会员订单不可退款。', 409);
  if (order.refund && order.refund.status !== 'FAILED') return {eligible: true, amountCents: order.refund.amountCents, deductedCents: order.refund.deductedCents, used: order.refund.deductedCents > 0};
  if (order.usage.some(item => item.state === 'RESERVED')) return {eligible: false, reason: '存在进行中的权益使用，请等待计费结果后再申请退款。', amountCents: 0, deductedCents: 0, used: false};
  const deadline = new Date(order.paidAt.getTime() + order.refundWindowHours * 3_600_000);
  if (now > deadline) return {eligible: false, reason: '已超过退款时间窗口。', amountCents: 0, deductedCents: 0, used: order.usage.length > 0, refundDeadline: deadline.toISOString()};
  const used = order.usage.some(item => item.state === 'CONSUMED');
  const deductedCents = used ? Math.min(order.amountCents, Math.ceil(order.amountCents * order.usageChargePeriodHours / (order.durationDays * 24))) : 0;
  return {eligible: true, amountCents: order.amountCents - deductedCents, deductedCents, used, refundDeadline: deadline.toISOString()};
}

/** Creates one refund request and revokes only the refunded order's grant after completion. */
export async function requestMembershipRefund(orderNo: string, reasonText = '会员退款', now = new Date()) {
  return db.$transaction(async tx => {
    const order = await tx.membershipOrder.findUnique({where: {orderNo}, include: {refund: true, usage: {select: {id: true, state: true}}}});
    if (!order || order.status !== 'PAID' || !order.paidAt) throw new MembershipError('会员订单不可退款。', 409);
    if (order.refund && order.refund.status !== 'FAILED') return order.refund;
    const deadline = new Date(order.paidAt.getTime() + order.refundWindowHours * 3_600_000);
    if (now > deadline) throw new MembershipError('已超过退款时间窗口。', 409);
    if (order.usage.some(item => item.state === 'RESERVED')) throw new MembershipError('存在进行中的权益使用，请等待计费结果后再申请退款。', 409, 'USAGE_RESERVED');
    const used = order.usage.some(item => item.state === 'CONSUMED');
    const deductedCents = used ? Math.min(order.amountCents, Math.ceil(order.amountCents * order.usageChargePeriodHours / (order.durationDays * 24))) : 0;
    if (order.refund?.status === 'FAILED') return tx.membershipRefund.update({where: {id: order.refund.id}, data: {status: 'PENDING', amountCents: order.amountCents - deductedCents, deductedCents, reason: reasonText.slice(0, 300), attempt: {increment: 1}, completedAt: null, providerRefundNo: null}});
    return tx.membershipRefund.create({data: {orderId: order.id, amountCents: order.amountCents - deductedCents, deductedCents, reason: reasonText.slice(0, 300)}});
  });
}

export async function completeMembershipRefund(orderNo: string, providerRefundNo?: string, now = new Date()) {
  return db.$transaction(async tx => {
    const order = await tx.membershipOrder.findUnique({where: {orderNo}, include: {refund: true, grant: true, paymentOrder: true}});
    if (!order?.refund) throw new MembershipError('退款申请不存在。', 404);
    if (order.refund.status === 'COMPLETED') return order.refund;
    const refund = await tx.membershipRefund.update({where: {id: order.refund.id}, data: {status: 'COMPLETED', providerRefundNo, completedAt: new Date()}});
    await tx.membershipOrder.update({where: {id: order.id}, data: {status: 'REFUNDED'}});
    await recordAffiliateRefundInTransaction(tx, {sourceType: 'MEMBERSHIP', sourceOrderId: order.id, refundKey: `membership:${order.refund.id}`, refundAmountCents: refund.amountCents});
    if (order.paymentOrder && order.paymentOrder.status !== 'REFUNDED') {
      await tx.paymentOrder.update({where: {id: order.paymentOrder.id}, data: {status: 'REFUNDED'}});
    }
    if (order.grant?.status === 'ACTIVE') {
      const revokedAt = now;
      await tx.membershipGrant.update({where: {id: order.grant.id}, data: {status: 'REVOKED', revokedAt}});
      // Remove only the refunded grant's remaining period. Future paid grants keep
      // their own duration and are shifted earlier by that exact gap, so no empty
      // membership hole is introduced and no other order is revoked.
      const anchor = revokedAt > order.grant.startsAt ? revokedAt : order.grant.startsAt;
      const gapMs = Math.max(0, order.grant.expiresAt.getTime() - anchor.getTime());
      if (gapMs > 0) {
        const future = await tx.membershipGrant.findMany({where: {userId: order.userId, status: 'ACTIVE', startsAt: {gte: order.grant.expiresAt}}, orderBy: {startsAt: 'asc'}});
        for (const grant of future) {
          await tx.membershipGrant.update({where: {id: grant.id}, data: {startsAt: new Date(grant.startsAt.getTime() - gapMs), expiresAt: new Date(grant.expiresAt.getTime() - gapMs)}});
        }
      }
    }
    return refund;
  });
}


/** The member may only read their own usage; no provider metadata or private prompts are exposed. */
export async function readOwnMembershipUsage(userId: string, input: {orderNo: string; cursor?: string | null; limit?: string | null}): Promise<MembershipUsagePage> {
  await pragmasReady;
  if (!input.orderNo || input.orderNo.length > 100) throw new MembershipError('会员订单不存在。', 404);
  const order = await db.membershipOrder.findFirst({where: {orderNo: input.orderNo, userId}, select: {id: true, orderNo: true, benefitsJson: true}});
  if (!order) throw new MembershipError('会员订单不存在。', 404);
  let before: {createdAt: Date; id: string} | undefined;
  if (input.cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
      const createdAt = new Date(parsed.createdAt);
      if (typeof parsed.id !== 'string' || !parsed.id || parsed.id.length > 100 || !Number.isFinite(createdAt.getTime())) throw Error();
      before = {createdAt, id: parsed.id};
    } catch {throw new MembershipError('使用记录游标无效。', 400);}
  }
  const limit = input.limit == null || input.limit === '' ? 20 : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new MembershipError('每页数量须为 1–100。', 400);
  const where = {userId, orderId: order.id};
  const [rows, grouped] = await Promise.all([
    db.membershipUsage.findMany({
      where: {...where, ...(before ? {OR: [{createdAt: {lt: before.createdAt}}, {createdAt: before.createdAt, id: {lt: before.id}}]} : {})},
      orderBy: [{createdAt: 'desc'}, {id: 'desc'}], take: limit + 1,
      select: {id: true, benefitCode: true, quantity: true, state: true, createdAt: true},
    }),
    db.membershipUsage.groupBy({where, by: ['state'], _sum: {quantity: true}}),
  ]);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const labels = new Map(parseBenefits(order.benefitsJson).map(item => [item.key as string, item.label]));
  const summary = {reserved: 0, consumed: 0, released: 0};
  for (const row of grouped) {
    if (row.state === 'RESERVED') summary.reserved = row._sum.quantity ?? 0;
    else if (row.state === 'CONSUMED') summary.consumed = row._sum.quantity ?? 0;
    else if (row.state === 'RELEASED') summary.released = row._sum.quantity ?? 0;
  }
  const last = page.at(-1);
  return {
    orderNo: order.orderNo,
    items: page.map(row => ({...row, label: labels.get(row.benefitCode) ?? row.benefitCode, state: row.state as MembershipUsageState, createdAt: row.createdAt.toISOString(), affectsRefund: row.state === 'CONSUMED'})),
    nextCursor: hasMore && last ? Buffer.from(JSON.stringify({createdAt: last.createdAt.toISOString(), id: last.id})).toString('base64url') : null,
    summary,
  };
}
