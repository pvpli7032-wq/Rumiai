import {Prisma} from '@prisma/client';
import {db} from '@/lib/db';
import type {ChargeHoldResult, ChargeOperation, ChargeOutcome, ChargePriceSnapshot, ChargeStatus} from './types';

/**
 * 费用单的行形状、读取与「行 → 结果」映射（V3 表 18）。
 *
 * 这里只有一次只读查询和几个纯映射，不含状态机——状态机在 charge-service.ts。
 * 拆出来是因为这几个函数各自返回一种形状的回执，长期占据状态机文件约三分之一行数。
 */

export const CHARGE_SELECT = {
  id: true, userId: true, requestId: true, operation: true, status: true, coins: true, priceSnapshotJson: true,
  allowanceSource: true, conversationId: true, messageId: true, aiCallId: true, heldAt: true, settledAt: true, releasedAt: true,
  requestHash: true, cancelReason: true,
} as const;

export type HeldChargeRow = Prisma.GenerationChargeGetPayload<{select: typeof CHARGE_SELECT}>;

async function readChargeRow(userId: string, operation: ChargeOperation, requestId: string): Promise<HeldChargeRow | null> {
  return db.generationCharge.findUnique({where: {userId_operation_requestId: {userId, operation, requestId}}, select: CHARGE_SELECT});
}

function parseSnapshot(raw: string): ChargePriceSnapshot {
  return JSON.parse(raw) as ChargePriceSnapshot;
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

export {readChargeRow, parseSnapshot, toHoldResult, toOutcome};
