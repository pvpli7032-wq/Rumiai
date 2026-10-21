import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@/lib/db';
import {AdminOpsError, limitParam, statusParam} from './ops-error';

/**
 * 费用单列表（只读）。
 *
 * 排序按「最需要人看的在前」：HELD（钱已冻住没结算）→ UNKNOWN（结果不明）→ SETTLED → RELEASED，
 * 同组内按冻结时间倒序。游标是「组序号:冻结毫秒:费用单 id」，跨组也能连续翻页。
 */

const ORDER = ['HELD', 'UNKNOWN', 'SETTLED', 'RELEASED'] as const;
export type AdminChargeStatus = typeof ORDER[number];

export interface AdminChargeItem {
  id: string;
  userId: string;
  userName: string;
  operation: string;
  status: AdminChargeStatus;
  coins: number;
  allowanceSource: string | null;
  conversationId: string | null;
  heldAt: string;
  settledAt: string | null;
  releasedAt: string | null;
  ageMinutes: number;
}

export interface AdminChargePage {
  items: AdminChargeItem[];
  nextCursor: string | null;
  summary: {held: number; unknown: number; heldCoins: number};
}

const rowSelect = {
  id: true, userId: true, operation: true, status: true, coins: true, allowanceSource: true,
  conversationId: true, heldAt: true, settledAt: true, releasedAt: true,
  user: {select: {username: true, displayName: true}},
} satisfies Prisma.GenerationChargeSelect;

interface DecodedCursor {
  bucket: number;
  heldAt: Date;
  id: string;
}

function decodeCursor(raw: string | null): DecodedCursor | null {
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length !== 3) throw new AdminOpsError('分页游标无效，请刷新后重试。');
  const bucket = Number(parts[0]);
  const ms = Number(parts[1]);
  const id = parts[2];
  if (!Number.isSafeInteger(bucket) || bucket < 0 || bucket >= ORDER.length || !Number.isSafeInteger(ms) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new AdminOpsError('分页游标无效，请刷新后重试。');
  }
  return {bucket, heldAt: new Date(ms), id};
}

export async function listAdminCharges(query: {status?: string | null; cursor?: string | null; limit?: string | null}): Promise<AdminChargePage> {
  await pragmasReady;
  const limit = limitParam(query.limit ?? null, 20, 50);
  const status = statusParam(query.status ?? null, ORDER);
  const cursor = decodeCursor(query.cursor ?? null);
  const buckets: readonly AdminChargeStatus[] = status ? [status] : ORDER;
  const collected: Array<{row: Prisma.GenerationChargeGetPayload<{select: typeof rowSelect}>; bucket: number}> = [];
  let bucketIndex = status ? 0 : cursor?.bucket ?? 0;
  if (cursor && cursor.bucket >= buckets.length) bucketIndex = buckets.length;
  while (bucketIndex < buckets.length && collected.length < limit + 1) {
    const bucketStatus = buckets[bucketIndex];
    const where: Prisma.GenerationChargeWhereInput = {status: bucketStatus};
    // 只在游标所在的那一组加「排在游标之后」的条件；后续组从头开始。
    if (cursor && cursor.bucket === bucketIndex) {
      where.AND = [{OR: [{heldAt: {lt: cursor.heldAt}}, {heldAt: cursor.heldAt, id: {lt: cursor.id}}]}];
    }
    const rows = await db.generationCharge.findMany({
      where,
      orderBy: [{heldAt: 'desc'}, {id: 'desc'}],
      take: limit + 1 - collected.length,
      select: rowSelect,
    });
    collected.push(...rows.map(row => ({row, bucket: bucketIndex})));
    bucketIndex += 1;
  }
  const hasMore = collected.length > limit;
  const page = hasMore ? collected.slice(0, limit) : collected;
  const last = page[page.length - 1];
  const [held, unknown] = await Promise.all([
    db.generationCharge.aggregate({where: {status: 'HELD'}, _count: {_all: true}, _sum: {coins: true}}),
    db.generationCharge.count({where: {status: 'UNKNOWN'}}),
  ]);
  const now = Date.now();
  return {
    items: page.map(({row}) => ({
      id: row.id,
      userId: row.userId,
      userName: row.user.displayName ?? row.user.username,
      operation: row.operation,
      status: row.status as AdminChargeStatus,
      coins: row.coins,
      allowanceSource: row.allowanceSource,
      conversationId: row.conversationId,
      heldAt: row.heldAt.toISOString(),
      settledAt: row.settledAt ? row.settledAt.toISOString() : null,
      releasedAt: row.releasedAt ? row.releasedAt.toISOString() : null,
      ageMinutes: Math.max(0, Math.floor((now - row.heldAt.getTime()) / 60000)),
    })),
    nextCursor: hasMore && last ? `${last.bucket}:${last.row.heldAt.getTime()}:${last.row.id}` : null,
    summary: {held: held._count._all, unknown, heldCoins: held._sum.coins ?? 0},
  };
}
