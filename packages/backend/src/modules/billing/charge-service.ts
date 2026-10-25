import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {db} from '@rumiai/backend/infrastructure/database/client';
import {lockAllowanceDay, readBillingTimezone, readFreeDailyLimit, readDailyAllowance, resolveBillingDayBoundary} from '@rumiai/backend/modules/billing/allowance';
import {quoteReplyPrice} from '@rumiai/backend/modules/billing/price';
import {CHARGE_SELECT, parseSnapshot, readChargeRow, toHoldResult, toOutcome, type HeldChargeRow} from '@rumiai/backend/modules/billing/charge-view';
import {
  HOLD_SOURCE_KEY, SETTLE_SOURCE_KEY, RELEASE_SOURCE_KEY, cancelReasonOf,
  type AllowanceSource, type ChargeCancelReason, type ChargeHoldResult, type ChargeOperation, type ChargeOutcome, type ChargePriceSnapshot, type ChargeRecord, type ChargeStatus,
  type HoldInput, type ReleaseInput, type SettleInput,
} from '@rumiai/contracts/billing/types';
import {readMembershipBenefit, recordMembershipUsageInTransaction, updateMembershipUsageStateInTransaction} from '@rumiai/backend/modules/memberships/service';
import {readSettingValue} from '@rumiai/backend/modules/settings/service';

/**
 * 费用服务的唯一入口：quote → hold → settle / release（V3 表 18）。
 *
 * 状态机逐字对应 V3 表 17：
 * - HELD：同一事务里条件扣余额、写唯一负数流水、建 HELD 费用单。
 * - SETTLED：消息已保存后把费用单置 SETTLED，负数流水归为聊天消费，不再扣一次。
 * - RELEASED：失败/取消，写唯一正数流水并置 RELEASED。
 * - UNKNOWN：结果不明，不重复扣、不自动补回，等 recovery 读权威状态。
 *
 * 幂等：同一 (userId, operation, requestId) 只有一条费用单；重放返回原单据与结果，
 * 不再调用模型、不再扣币。免费次数的预占按「已占用次数」判断（free_used + free_reserved
 * 不超过上限），结算/释放各只生效一次，业务日取自价格快照里的 day。
 *
 * 与消费方提交的一致性：故事链在自己的提交事务里先落回合行（requestId 唯一），
 * 提交成功后再结算；万一结算中断，recovery 按「回合已提交」补结算，不会出现付款丢失。
 */

/** 免费额度的预留行 id：由 requestId 与业务日推出，结算/释放据它做幂等条件。 */
export function reservationId(requestId: string, day: string): string {
  return (requestId.slice(0, 24) + '@' + day);
}

/**
 * 请求号冲突：同一个 requestId 已经用于另一条会话，或提交的内容与首次不同（V3 §20）。
 * 两种情况都不能回放旧结果——用户会看到一段不是自己要的回复。
 */
export class ChargeRequestConflictError extends Error {
  constructor(readonly requestId: string, reason: 'conversation' | 'content' = 'conversation') {
    super(reason === 'content' ? '这个请求编号已经提交过别的内容，请刷新页面后重新发送。' : '请求标识已用于另一条会话，请刷新后重试。');
    this.name = 'ChargeRequestConflictError';
  }
}

/**
 * 请求内容摘要：sha256 前 32 位十六进制，只用来判断「同一个请求号是不是同一件事」。
 * 输入是用户实际提交的内容，不是请求号本身（哈希请求号会恒等，等于没判）。
 * schemaVersion 留在输入里，将来换算法时旧摘要不会被误判成同一次请求。
 */
export function requestDigest(content: string): string {
  return createHash('sha256').update(JSON.stringify({schemaVersion: 1, content})).digest('hex').slice(0, 32);
}

/**
 * 已有费用单 vs 本次请求：会话变了是冲突，内容变了也是冲突。
 * 老单据 requestHash 为 null（这一列上线前的数据）时不做内容判定，不能把历史数据判成冲突。
 */
function assertSameRequest(existing: HeldChargeRow, input: HoldInput, digest: string | null): void {
  if (input.conversationId && existing.conversationId && existing.conversationId !== input.conversationId) {
    throw new ChargeRequestConflictError(input.requestId);
  }
  if (digest && existing.requestHash && existing.requestHash !== digest) throw new ChargeRequestConflictError(input.requestId, 'content');
}

/** 余额不足以支付本条回复；价格与免费次数一并返回，前台可直接展示「去充值」。 */
export class InsufficientCoinsError extends Error {
  readonly code = 'INSUFFICIENT_COINS';
  constructor(readonly coins: number, readonly balance: number, readonly allowance: Awaited<ReturnType<typeof readDailyAllowance>>) {
    super('金币余额不足，本条需要 ' + coins + ' 币，当前 ' + balance + ' 币。');
    this.name = 'InsufficientCoinsError';
  }
}

/** Charging is enabled but the selected model has no effective per-reply price. */
export class MissingModelPriceError extends Error {
  readonly code = 'MODEL_PRICE_NOT_CONFIGURED';
  constructor(readonly modelKey: string | null) {
    super(modelKey ? `模型 ${modelKey} 尚未配置每条回复币价，暂时无法生成。` : '当前模型尚未配置每条回复币价，暂时无法生成。');
    this.name = 'MissingModelPriceError';
  }
}

/** 报价：价格快照 + 当前业务日；/api/me/quota 与后台价格页都读这一份。 */
export async function quote(input: {userId: string; operation: ChargeOperation; modelKey?: string | null; now?: Date}) {
  const now = input.now ?? new Date();
  const quoted = await quoteReplyPrice({...input, now});
  const boundary = resolveBillingDayBoundary(now, quoted.timezone);
  return {...quoted, day: boundary.day, resetAt: boundary.resetAt.toISOString()};
}

/**
 * 预扣。chargingEnabled 关闭或倍率为0时，聊天保留零额请求回执、不动余额；收费已开启但
 * 没有币价属于配置错误，必须在调用供应商前停止，不能悄悄降级成免费生成。
 */
export async function holdCharge(input: HoldInput): Promise<ChargeHoldResult> {
  const now = input.now ?? new Date();
  const digest = input.requestContent == null ? null : requestDigest(input.requestContent);
  const quoted = await quoteReplyPrice({userId: input.userId, operation: input.operation, modelKey: input.modelKey, now});
  const existingRow = await readChargeRow(input.userId, input.operation, input.requestId);
  // 关闭收费只影响新请求：已经 HELD 的旧费用单仍按实际结果结算（V3 §20）。
  if (existingRow) {
    assertSameRequest(existingRow, input, digest);
    return {...toHoldResult(existingRow, true), debited: 0};
  }
  if (quoted.pricing === 'NO_PRICE') throw new MissingModelPriceError(quoted.modelKey);
  if (!quoted.charged) {
    const boundary = resolveBillingDayBoundary(now, quoted.timezone);
    // Free chat still needs a durable receipt: request replay must never call AI twice.
    // No coins or daily free quota are reserved by these zero-amount rows.
    if (input.operation === 'CHAT_SEND' || input.operation === 'CHAT_REGENERATE') {
      return db.$transaction(async tx => {
        await lockAllowanceDay(tx, input.userId);
        const raced = await tx.generationCharge.findUnique({where: {userId_operation_requestId: {userId: input.userId, operation: input.operation, requestId: input.requestId}}, select: CHARGE_SELECT});
        if (raced) {
          assertSameRequest(raced, input, digest);
          return {...toHoldResult(raced, true), debited: 0};
        }
        const snapshot: ChargePriceSnapshot = {...quoted, day: boundary.day, allowanceSource: 'FREE_MODE', reservationId: null};
        const row = await tx.generationCharge.create({data: {
          userId: input.userId, requestId: input.requestId, operation: input.operation, status: 'HELD',
          coins: 0, allowanceSource: 'FREE_MODE', conversationId: input.conversationId ?? null,
          requestHash: digest, priceSnapshotJson: JSON.stringify(snapshot), heldAt: now,
        }, select: CHARGE_SELECT});
        return {...toHoldResult(row, false), debited: 0};
      }, {timeout: 30_000});
    }
    return {
      requestId: input.requestId, operation: input.operation, held: false, chargeId: null, status: null, coins: 0,
      allowanceSource: 'FREE_MODE', price: {...quoted, day: boundary.day}, aiCallId: null, messageId: null,
      conversationId: input.conversationId ?? null, debited: 0, replayed: false, userId: input.userId,
      heldAt: now.toISOString(), settledAt: null, releasedAt: null,
    };
  }

  const [timezone, freeLimit, publicFreeLimit] = await Promise.all([readBillingTimezone(input.userId), readFreeDailyLimit(input.userId), readSettingValue<number>('billing.freeDailyMessages', input.userId)]);
  const membershipDaily = await readMembershipBenefit(input.userId, 'DAILY_FREE_REPLIES');
  const boundary = resolveBillingDayBoundary(now, timezone);

  try {
    return await db.$transaction(async tx => {
      // 同一用户同一业务日串行：先取 users 行的写锁，再判断免费额度/余额。
      await lockAllowanceDay(tx, input.userId);
      const raced = await tx.generationCharge.findUnique({where: {userId_operation_requestId: {userId: input.userId, operation: input.operation, requestId: input.requestId}}, select: CHARGE_SELECT});
      if (raced) {
        assertSameRequest(raced, input, digest);
        return {...toHoldResult(raced, true), debited: 0};
      }

      const resId = reservationId(input.requestId, boundary.day);
      let allowanceSource: AllowanceSource = 'PAID';
      // MIRROR 是「购买次数」，已经有自己的每日次数（mirror.userDailyLimit），
      // 不能再吃掉聊天的免费回复条数，所以这里只走 PAID。
      if (freeLimit > 0 && input.operation !== 'MIRROR') {
        // 一条语句完成「检查 + 预占」：已占用达到上限时 UPDATE 不生效，影响行数为 0。
        const reserved = await tx.$executeRaw`INSERT INTO user_daily_allowances (user_id, day, free_used, free_reserved)
          VALUES (${input.userId}, ${boundary.day}, 0, 1)
          ON CONFLICT(user_id, day) DO UPDATE SET free_reserved = free_reserved + 1 WHERE free_used + free_reserved < ${freeLimit}`;
        if (reserved > 0) allowanceSource = 'FREE_QUOTA';
      }

      if (allowanceSource === 'PAID') {
        const debited = await tx.user.updateMany({where: {id: input.userId, coins: {gte: quoted.coins}}, data: {coins: {decrement: quoted.coins}}});
        if (!debited.count) {
          const balance = (await tx.user.findUnique({where: {id: input.userId}, select: {coins: true}}))?.coins ?? 0;
          throw new InsufficientCoinsError(quoted.coins, balance, await readDailyAllowance(input.userId, {now}));
        }
      }

      const allowance = allowanceSource === 'FREE_QUOTA' ? await tx.userDailyAllowance.findUnique({where:{userId_day:{userId:input.userId,day:boundary.day}},select:{freeUsed:true,freeReserved:true}}) : null;
      const membershipDailyOrderNo = membershipDaily && allowanceSource === 'FREE_QUOTA' && ((allowance?.freeUsed ?? 0) + (allowance?.freeReserved ?? 0) > Math.max(0, Math.trunc(publicFreeLimit))) ? membershipDaily.orderNo : null;
      const snapshot: ChargePriceSnapshot = {...quoted, allowanceSource, day: boundary.day, reservationId: allowanceSource === 'FREE_QUOTA' ? resId : null, membershipDailyOrderNo};
      const charge = await tx.generationCharge.create({
        data: {
          userId: input.userId, requestId: input.requestId, operation: input.operation, status: 'HELD',
          coins: allowanceSource === 'PAID' ? quoted.coins : 0,
          priceSnapshotJson: JSON.stringify(snapshot),
          allowanceSource, conversationId: input.conversationId ?? null, heldAt: now, requestHash: digest,
        },
        select: CHARGE_SELECT,
      });
      if (allowanceSource === 'PAID') {
        await tx.coinTransaction.create({
          data: {
            userId: input.userId, amount: -quoted.coins, type: 'SPENT', sourceKey: HOLD_SOURCE_KEY,
            description: `预扣 ${quoted.coins} 币（请求 ${input.requestId}）`, chargeId: charge.id, chargeAction: 'HOLD',
          },
        });
      }
      if (membershipDailyOrderNo) await recordMembershipUsageInTransaction(tx, {orderNo: membershipDailyOrderNo, userId: input.userId, benefitCode: 'DAILY_FREE_REPLIES', idempotencyKey: createHash('sha256').update(`${input.requestId}:daily`).digest('hex'), state: 'RESERVED', chargeId: charge.id});
      if (snapshot.membershipMultiplierOrderNo && (input.operation === 'CHAT_SEND' || input.operation === 'CHAT_REGENERATE')) await recordMembershipUsageInTransaction(tx, {orderNo: snapshot.membershipMultiplierOrderNo, userId: input.userId, benefitCode: 'CHAT_PRICE_MULTIPLIER', idempotencyKey: createHash('sha256').update(`${input.requestId}:multiplier`).digest('hex'), state: 'RESERVED', chargeId: charge.id});
      return toHoldResult(charge, false);
    }, {timeout: 30_000});
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // 并发同号请求：对方先建成费用单，本次不重复扣币，直接返回那一张。
      const raced = await readChargeRow(input.userId, input.operation, input.requestId);
      if (raced) {
        assertSameRequest(raced, input, digest);
        return {...toHoldResult(raced, true), debited: 0};
      }
    }
    throw error;
  }
}

/**
 * 事务内的结算/释放：取消策略（cancel.ts）要在一个事务里「判定 + 占用免费取消次数 + 落账」，
 * 所以把两条路径拆成事务内函数，公开的 settleCharge / releaseCharge 只是包一层事务。
 */
export type Tx = Prisma.TransactionClient;

export async function findChargeInTx(tx: Tx, userId: string, operation: ChargeOperation, requestId: string): Promise<HeldChargeRow | null> {
  return tx.generationCharge.findUnique({where: {userId_operation_requestId: {userId, operation, requestId}}, select: CHARGE_SELECT});
}

function replayedOutcome(row: HeldChargeRow, input: {userId: string; requestId: string; operation: ChargeOperation}): ChargeOutcome {
  return toOutcome({userId: input.userId, requestId: input.requestId, operation: input.operation, status: row.status as ChargeStatus, coins: row.coins, allowanceSource: (row.allowanceSource ?? 'PAID') as ChargeHoldResult['allowanceSource'], balanceDelta: 0, replayed: true, row});
}

/** 消息已保存 → 结算。HELD → SETTLED，预扣流水归为聊天消费，不再扣余额。 */
export async function settleInTx(tx: Tx, existing: HeldChargeRow | null, input: SettleInput, now: Date): Promise<ChargeOutcome> {
  if (!existing) return toOutcome({userId: input.userId, requestId: input.requestId, operation: input.operation, status: 'FREE', coins: 0, allowanceSource: 'FREE_MODE', balanceDelta: 0, replayed: false});
  if (input.messageId && !existing.messageId) await tx.generationCharge.updateMany({where: {id: existing.id, messageId: null}, data: {messageId: input.messageId}});
  if (input.aiCallId && !existing.aiCallId) await tx.generationCharge.updateMany({where: {id: existing.id, aiCallId: null}, data: {aiCallId: input.aiCallId}});
  // 取消原因和状态在同一个条件更新里写：只有真正从 HELD 转过去的那一次会落值，
  // 重放不会改写已终结的单（V3 §157）。
  const settled = await tx.generationCharge.updateMany({
    where: {id: existing.id, status: 'HELD'},
    data: {status: 'SETTLED', settledAt: now, updatedAt: now, ...(input.cancelReason ? {cancelReason: cancelReasonOf(input.cancelReason)} : {})},
  });
  // 已结算不再扣、已释放不再补、UNKNOWN 不动——重复回调拿到同一结果。
  if (!settled.count) return replayedOutcome(await tx.generationCharge.findUniqueOrThrow({where: {id: existing.id}, select: CHARGE_SELECT}), input);
  const snapshot = parseSnapshot(existing.priceSnapshotJson);
  if (snapshot.allowanceSource === 'FREE_QUOTA') {
    // 预占转为已用：同一条语句里 --reserved / ++used，额度判定仍按 free_used + free_reserved。
    await tx.$executeRaw`UPDATE user_daily_allowances SET free_reserved = free_reserved - 1, free_used = free_used + 1
      WHERE user_id = ${input.userId} AND day = ${snapshot.day} AND free_reserved > 0`;
  } else {
    // 付费那条：负数流水从「聊天预扣」归为「聊天消费」，金额不再变动。
    await tx.coinTransaction.updateMany({where: {chargeId: existing.id, chargeAction: 'HOLD'}, data: {sourceKey: SETTLE_SOURCE_KEY}});
  }
  if (snapshot.membershipDailyOrderNo) await updateMembershipUsageStateInTransaction(tx, {chargeId: existing.id, benefitCode: 'DAILY_FREE_REPLIES', state: 'CONSUMED'});
  if (snapshot.membershipMultiplierOrderNo && (input.operation === 'CHAT_SEND' || input.operation === 'CHAT_REGENERATE')) await updateMembershipUsageStateInTransaction(tx, {chargeId: existing.id, benefitCode: 'CHAT_PRICE_MULTIPLIER', state: 'CONSUMED'});
  const row = await tx.generationCharge.findUniqueOrThrow({where: {id: existing.id}, select: CHARGE_SELECT});
  return toOutcome({userId: input.userId, requestId: input.requestId, operation: input.operation, status: 'SETTLED', coins: row.coins, allowanceSource: (row.allowanceSource ?? 'PAID') as ChargeHoldResult['allowanceSource'], balanceDelta: 0, replayed: false, row});
}

/** 失败/取消 → 释放。HELD → RELEASED：补回原预扣金额一次 + 唯一正数流水。 */
export async function releaseInTx(tx: Tx, existing: HeldChargeRow | null, input: ReleaseInput, now: Date): Promise<ChargeOutcome> {
  if (!existing) return toOutcome({userId: input.userId, requestId: input.requestId, operation: input.operation, status: 'FREE', coins: 0, allowanceSource: 'FREE_MODE', balanceDelta: 0, replayed: false});
  if (input.messageId) await tx.generationCharge.updateMany({where: {id: existing.id, messageId: null}, data: {messageId: input.messageId}});
  // 原因只在调用方给了才写：没给就留空，不替调用方猜一个「上游失败」。
  const released = await tx.generationCharge.updateMany({
    where: {id: existing.id, status: 'HELD'},
    data: {
      status: 'RELEASED', releasedAt: now, updatedAt: now,
      ...(input.aiCallId ? {aiCallId: input.aiCallId} : {}),
      ...(input.reason ? {cancelReason: cancelReasonOf(input.reason)} : {}),
    },
  });
  // 已释放不重复补、已结算不再退——重复回调拿到同一结果。
  if (!released.count) return replayedOutcome(await tx.generationCharge.findUniqueOrThrow({where: {id: existing.id}, select: CHARGE_SELECT}), input);
  const snapshot = parseSnapshot(existing.priceSnapshotJson);
  if (snapshot.membershipDailyOrderNo) await updateMembershipUsageStateInTransaction(tx, {chargeId: existing.id, benefitCode: 'DAILY_FREE_REPLIES', state: 'RELEASED'});
  if (snapshot.membershipMultiplierOrderNo && (input.operation === 'CHAT_SEND' || input.operation === 'CHAT_REGENERATE')) await updateMembershipUsageStateInTransaction(tx, {chargeId: existing.id, benefitCode: 'CHAT_PRICE_MULTIPLIER', state: 'RELEASED'});
  let delta = 0;
  if (snapshot.allowanceSource === 'FREE_QUOTA') {
    // 免费额度：预占还回去，free_used 不动（未消耗）。
    await tx.$executeRaw`UPDATE user_daily_allowances SET free_reserved = free_reserved - 1
      WHERE user_id = ${input.userId} AND day = ${snapshot.day} AND free_reserved > 0`;
  } else if (existing.coins > 0) {
    await tx.user.update({where: {id: input.userId}, data: {coins: {increment: existing.coins}}});
    await tx.coinTransaction.create({
      data: {
        userId: input.userId, amount: existing.coins, type: 'EARNED', sourceKey: RELEASE_SOURCE_KEY,
        description: `生成未完成，返还预扣 ${existing.coins} 币（请求 ${input.requestId} · ${(input.reason ?? 'CANCELLED').slice(0, 40)}）`,
        chargeId: existing.id, chargeAction: 'RELEASE',
      },
    });
    delta = existing.coins;
  }
  const row = await tx.generationCharge.findUniqueOrThrow({where: {id: existing.id}, select: CHARGE_SELECT});
  return toOutcome({userId: input.userId, requestId: input.requestId, operation: input.operation, status: 'RELEASED', coins: row.coins, allowanceSource: (row.allowanceSource ?? 'PAID') as ChargeHoldResult['allowanceSource'], balanceDelta: delta, replayed: false, row});
}

export async function settleCharge(input: SettleInput): Promise<ChargeOutcome> {
  const now = input.now ?? new Date();
  return db.$transaction(async tx => settleInTx(tx, await findChargeInTx(tx, input.userId, input.operation, input.requestId), input, now), {timeout: 30_000});
}

export async function releaseCharge(input: ReleaseInput): Promise<ChargeOutcome> {
  const now = input.now ?? new Date();
  return db.$transaction(async tx => releaseInTx(tx, await findChargeInTx(tx, input.userId, input.operation, input.requestId), input, now), {timeout: 30_000});
}

/**
 * 结果不明：HELD → UNKNOWN。不重复扣、也不自动补回；余额与流水都保持原样，
 * 由 recovery 读权威状态（消息是否已保存）后再结算或释放（V3 §21「超时检查」）。
 */
export async function markChargeUnknown(input: SettleInput): Promise<ChargeOutcome> {
  const now = input.now ?? new Date();
  return db.$transaction(async tx => {
    const existing = await tx.generationCharge.findUnique({where: {userId_operation_requestId: {userId: input.userId, operation: input.operation, requestId: input.requestId}}, select: CHARGE_SELECT});
    if (!existing) return toOutcome({userId: input.userId, requestId: input.requestId, operation: input.operation, status: 'FREE', coins: 0, allowanceSource: 'FREE_MODE', balanceDelta: 0, replayed: false});
    const marked = await tx.generationCharge.updateMany({where: {id: existing.id, status: 'HELD'}, data: {status: 'UNKNOWN', updatedAt: now, ...(input.aiCallId ? {aiCallId: input.aiCallId} : {})}});
    const row = await tx.generationCharge.findUniqueOrThrow({where: {id: existing.id}, select: CHARGE_SELECT});
    return toOutcome({userId: input.userId, requestId: input.requestId, operation: input.operation, status: row.status as ChargeStatus, coins: row.coins, allowanceSource: (row.allowanceSource ?? 'PAID') as ChargeHoldResult['allowanceSource'], balanceDelta: 0, replayed: marked.count === 0, row});
  });
}

export async function readCharge(userId: string, operation: ChargeOperation, requestId: string): Promise<ChargeRecord | null> {
  const row = await readChargeRow(userId, operation, requestId);
  if (!row) return null;
  return {
    id: row.id, userId: row.userId, requestId: row.requestId, operation: row.operation as ChargeOperation,
    status: row.status as ChargeStatus, coins: row.coins, allowanceSource: (row.allowanceSource ?? null) as ChargeRecord['allowanceSource'],
    conversationId: row.conversationId, messageId: row.messageId, aiCallId: row.aiCallId,
    heldAt: row.heldAt.toISOString(), settledAt: row.settledAt?.toISOString() ?? null, releasedAt: row.releasedAt?.toISOString() ?? null,
    requestHash: row.requestHash,
    cancelReason: (row.cancelReason ?? null) as ChargeCancelReason | null,
    price: parseSnapshot(row.priceSnapshotJson),
  };
}
