import {Prisma} from '@prisma/client';
import {db} from '@/lib/db';
import {lockAllowanceDay, readBillingTimezone, readFreeDailyLimit, readDailyAllowance, resolveBillingDayBoundary} from './allowance';
import {quoteReplyPrice} from './price';
import {
  HOLD_SOURCE_KEY, SETTLE_SOURCE_KEY, RELEASE_SOURCE_KEY,
  type AllowanceSource, type ChargeHoldResult, type ChargeOperation, type ChargeOutcome, type ChargePriceSnapshot, type ChargeRecord, type ChargeStatus,
  type HoldInput, type ReleaseInput, type SettleInput,
} from './types';

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

const CHARGE_SELECT = {
  id: true, userId: true, requestId: true, operation: true, status: true, coins: true, priceSnapshotJson: true,
  allowanceSource: true, conversationId: true, messageId: true, aiCallId: true, heldAt: true, settledAt: true, releasedAt: true,
} as const;

type HeldChargeRow = Prisma.GenerationChargeGetPayload<{select: typeof CHARGE_SELECT}>;

/** 免费额度的预留行 id：由 requestId 与业务日推出，结算/释放据它做幂等条件。 */
export function reservationId(requestId: string, day: string): string {
  return (requestId.slice(0, 24) + '@' + day);
}

function parseSnapshot(raw: string): ChargePriceSnapshot {
  return JSON.parse(raw) as ChargePriceSnapshot;
}

/** 预扣所需参数冲突：同一 requestId 已经用于另一条会话。 */
export class ChargeRequestConflictError extends Error {
  constructor(readonly requestId: string) {
    super('请求标识已用于另一条会话，请刷新后重试。');
    this.name = 'ChargeRequestConflictError';
  }
}

/** 余额不足以支付本条回复；价格与免费次数一并返回，前台可直接展示「去充值」。 */
export class InsufficientCoinsError extends Error {
  readonly code = 'INSUFFICIENT_COINS';
  constructor(readonly coins: number, readonly balance: number, readonly allowance: Awaited<ReturnType<typeof readDailyAllowance>>) {
    super('金币余额不足，本条需要 ' + coins + ' 币，当前 ' + balance + ' 币。');
    this.name = 'InsufficientCoinsError';
  }
}

async function readChargeRow(userId: string, operation: ChargeOperation, requestId: string): Promise<HeldChargeRow | null> {
  return db.generationCharge.findUnique({where: {userId_operation_requestId: {userId, operation, requestId}}, select: CHARGE_SELECT});
}

function toHoldResult(row: HeldChargeRow, replayed: boolean): ChargeHoldResult {
  return {
    requestId: row.requestId,
    operation: row.operation as ChargeOperation,
    held: true,
    chargeId: row.id,
    status: row.status as ChargeStatus,
    coins: row.coins,
    allowanceSource: (row.allowanceSource ?? 'PAID') as ChargeHoldResult['allowanceSource'],
    price: parseSnapshot(row.priceSnapshotJson),
    aiCallId: row.aiCallId,
    messageId: row.messageId,
    conversationId: row.conversationId,
    debited: replayed ? 0 : row.coins,
    replayed,
    userId: row.userId,
    heldAt: row.heldAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
    releasedAt: row.releasedAt?.toISOString() ?? null,
  };
}

function toOutcome(params: {
  requestId: string; operation: ChargeOperation; status: ChargeStatus | 'FREE'; coins: number;
  allowanceSource: ChargeHoldResult['allowanceSource']; balanceDelta: number; replayed: boolean; userId: string; row?: HeldChargeRow | null;
}): ChargeOutcome {
  return {
    requestId: params.requestId,
    operation: params.operation,
    chargeId: params.row?.id ?? null,
    status: params.status,
    coins: params.coins,
    allowanceSource: params.allowanceSource,
    balanceDelta: params.balanceDelta,
    aiCallId: params.row?.aiCallId ?? null,
    messageId: params.row?.messageId ?? null,
    heldAt: params.row?.heldAt.toISOString() ?? null,
    settledAt: params.row?.settledAt?.toISOString() ?? null,
    releasedAt: params.row?.releasedAt?.toISOString() ?? null,
    replayed: params.replayed,
    userId: params.userId,
  };
}

/** 报价：价格快照 + 当前业务日；/api/me/quota 与后台价格页都读这一份。 */
export async function quote(input: {userId: string; operation: ChargeOperation; modelKey?: string | null; now?: Date}) {
  const now = input.now ?? new Date();
  const quoted = await quoteReplyPrice({...input, now});
  const boundary = resolveBillingDayBoundary(now, quoted.timezone);
  return {...quoted, day: boundary.day, resetAt: boundary.resetAt.toISOString()};
}

/**
 * 预扣。chargingEnabled 关闭、倍率为 0 或没有可用币价时不建费用单、不动余额，
 * 返回 held=false 的回执（调用方照常生成，只记 AiCall 成本）。
 */
export async function holdCharge(input: HoldInput): Promise<ChargeHoldResult> {
  const now = input.now ?? new Date();
  const quoted = await quoteReplyPrice({userId: input.userId, operation: input.operation, modelKey: input.modelKey, now});
  const existingRow = await readChargeRow(input.userId, input.operation, input.requestId);
  // 关闭收费只影响新请求：已经 HELD 的旧费用单仍按实际结果结算（V3 §20）。
  if (existingRow) {
    if (input.conversationId && existingRow.conversationId && existingRow.conversationId !== input.conversationId) throw new ChargeRequestConflictError(input.requestId);
    return {...toHoldResult(existingRow, true), debited: 0};
  }
  if (!quoted.charged) {
    const boundary = resolveBillingDayBoundary(now, quoted.timezone);
    return {
      requestId: input.requestId, operation: input.operation, held: false, chargeId: null, status: null, coins: 0,
      allowanceSource: 'FREE_MODE', price: {...quoted, day: boundary.day}, aiCallId: null, messageId: null,
      conversationId: input.conversationId ?? null, debited: 0, replayed: false, userId: input.userId,
      heldAt: now.toISOString(), settledAt: null, releasedAt: null,
    };
  }

  const [timezone, freeLimit] = await Promise.all([readBillingTimezone(input.userId), readFreeDailyLimit(input.userId)]);
  const boundary = resolveBillingDayBoundary(now, timezone);

  try {
    return await db.$transaction(async tx => {
      // 同一用户同一业务日串行：先取 users 行的写锁，再判断免费额度/余额。
      await lockAllowanceDay(tx, input.userId);
      const raced = await tx.generationCharge.findUnique({where: {userId_operation_requestId: {userId: input.userId, operation: input.operation, requestId: input.requestId}}, select: CHARGE_SELECT});
      if (raced) return {...toHoldResult(raced, true), debited: 0};

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

      const snapshot: ChargePriceSnapshot = {...quoted, allowanceSource, day: boundary.day, reservationId: allowanceSource === 'FREE_QUOTA' ? resId : null};
      const charge = await tx.generationCharge.create({
        data: {
          userId: input.userId, requestId: input.requestId, operation: input.operation, status: 'HELD',
          coins: allowanceSource === 'PAID' ? quoted.coins : 0,
          priceSnapshotJson: JSON.stringify(snapshot),
          allowanceSource, conversationId: input.conversationId ?? null, heldAt: now,
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
      return toHoldResult(charge, false);
    }, {timeout: 30_000});
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // 并发同号请求：对方先建成费用单，本次不重复扣币，直接返回那一张。
      const raced = await readChargeRow(input.userId, input.operation, input.requestId);
      if (raced) return {...toHoldResult(raced, true), debited: 0};
    }
    throw error;
  }
}

/** 消息已保存 → 结算。HELD → SETTLED，预扣流水归为聊天消费，不再扣余额。 */
export async function settleCharge(input: SettleInput): Promise<ChargeOutcome> {
  const now = input.now ?? new Date();
  const outcome = await db.$transaction(async tx => {
    const existing = await tx.generationCharge.findUnique({where: {userId_operation_requestId: {userId: input.userId, operation: input.operation, requestId: input.requestId}}, select: CHARGE_SELECT});
    if (!existing) return toOutcome({userId: input.userId, requestId: input.requestId, operation: input.operation, status: 'FREE', coins: 0, allowanceSource: 'FREE_MODE', balanceDelta: 0, replayed: false});
    if (input.messageId && !existing.messageId) await tx.generationCharge.updateMany({where: {id: existing.id, messageId: null}, data: {messageId: input.messageId}});
    if (input.aiCallId && !existing.aiCallId) await tx.generationCharge.updateMany({where: {id: existing.id, aiCallId: null}, data: {aiCallId: input.aiCallId}});
    const settled = await tx.generationCharge.updateMany({where: {id: existing.id, status: 'HELD'}, data: {status: 'SETTLED', settledAt: now, updatedAt: now}});
    if (!settled.count) {
      // 已结算不再扣、已释放不再补、UNKNOWN 不动——重复回调拿到同一结果。
      const current = await tx.generationCharge.findUniqueOrThrow({where: {id: existing.id}, select: CHARGE_SELECT});
      return toOutcome({userId: input.userId, requestId: input.requestId, operation: input.operation, status: current.status as ChargeStatus, coins: current.coins, allowanceSource: (current.allowanceSource ?? 'PAID') as ChargeHoldResult['allowanceSource'], balanceDelta: 0, replayed: true, row: current});
    }
    const snapshot = parseSnapshot(existing.priceSnapshotJson);
    if (snapshot.allowanceSource === 'FREE_QUOTA') {
      // 预占转为已用：同一条语句里 --reserved / ++used，额度判定仍按 free_used + free_reserved。
      await tx.$executeRaw`UPDATE user_daily_allowances SET free_reserved = free_reserved - 1, free_used = free_used + 1
        WHERE user_id = ${input.userId} AND day = ${snapshot.day} AND free_reserved > 0`;
    } else {
      await tx.coinTransaction.updateMany({where: {chargeId: existing.id, chargeAction: 'HOLD'}, data: {sourceKey: SETTLE_SOURCE_KEY}});
    }
    const row = await tx.generationCharge.findUniqueOrThrow({where: {id: existing.id}, select: CHARGE_SELECT});
    return toOutcome({userId: input.userId, requestId: input.requestId, operation: input.operation, status: 'SETTLED', coins: row.coins, allowanceSource: (row.allowanceSource ?? 'PAID') as ChargeHoldResult['allowanceSource'], balanceDelta: 0, replayed: false, row});
  }, {timeout: 30_000});
  return outcome;
}

/** 失败/取消 → 释放。HELD → RELEASED：补回原预扣金额一次 + 唯一正数流水。 */
export async function releaseCharge(input: ReleaseInput): Promise<ChargeOutcome> {
  const now = input.now ?? new Date();
  return db.$transaction(async tx => {
    const existing = await tx.generationCharge.findUnique({where: {userId_operation_requestId: {userId: input.userId, operation: input.operation, requestId: input.requestId}}, select: CHARGE_SELECT});
    if (!existing) return toOutcome({userId: input.userId, requestId: input.requestId, operation: input.operation, status: 'FREE', coins: 0, allowanceSource: 'FREE_MODE', balanceDelta: 0, replayed: false});
    if (input.messageId) await tx.generationCharge.updateMany({where: {id: existing.id, messageId: null}, data: {messageId: input.messageId}});
    const released = await tx.generationCharge.updateMany({where: {id: existing.id, status: 'HELD'}, data: {status: 'RELEASED', releasedAt: now, updatedAt: now, ...(input.aiCallId ? {aiCallId: input.aiCallId} : {})}});
    if (!released.count) {
      // 已释放不重复补、已结算不再退——重复回调拿到同一结果。
      const current = await tx.generationCharge.findUniqueOrThrow({where: {id: existing.id}, select: CHARGE_SELECT});
      return toOutcome({userId: input.userId, requestId: input.requestId, operation: input.operation, status: current.status as ChargeStatus, coins: current.coins, allowanceSource: (current.allowanceSource ?? 'PAID') as ChargeHoldResult['allowanceSource'], balanceDelta: 0, replayed: true, row: current});
    }
    const snapshot = parseSnapshot(existing.priceSnapshotJson);
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
  }, {timeout: 30_000});
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
    price: parseSnapshot(row.priceSnapshotJson),
  };
}