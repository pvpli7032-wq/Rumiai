import {db} from '@/lib/db';
import {readSetting, readSettingValue} from '@/lib/settings/service';
import {isValidTimezone, resolveZonedDay, resolveZonedDayBoundary} from '@/lib/time/zoned-day';
import type {DailyAllowanceView} from './types';

/**
 * 每日免费次数与业务日（V3 §20 / 表 8）。
 *
 * 业务日按 billing.dayTimezone 切换，不是进程本地时区，也不是写死的 UTC。
 * 只有 free_used / free_reserved 两列：已占用次数 = free_used + free_reserved，
 * 预占与释放都只改 free_reserved，结算在同一条 SQL 里 --reserved / ++used。
 * free_cancel_used 单独记当日免费取消次数（V3 表 16），只由 cancel.ts 的条件更新占用。
 * 并发靠 SQLite 写锁：调用方在同一事务里先对 users 行做一次空写（lockAllowanceDay）。
 */

export type {DayBoundary} from '@/lib/time/zoned-day';
export {resolveZonedDay as resolveBillingDay, resolveZonedDayBoundary as resolveBillingDayBoundary} from '@/lib/time/zoned-day';


export async function readBillingTimezone(userId?: string | null): Promise<string> {
  const setting = await readSetting('billing.dayTimezone', userId);
  const raw = setting.value;
  const timezone = typeof raw === 'string' && raw.trim() ? raw.trim() : 'UTC';
  return isValidTimezone(timezone) ? timezone : 'UTC';
}

export async function readFreeDailyLimit(userId: string): Promise<number> {
  const value = await readSettingValue<number>('billing.freeDailyMessages', userId);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/** 每日免费取消次数（V3 表 8）：只在「已输出即收费」策略下生效，0 表示取消即收费。 */
export async function readFreeCancelLimit(userId: string): Promise<number> {
  const value = await readSettingValue<number>('billing.freeCancelPerDay', userId);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 3;
}

/** 同一用户同一业务日内串行：对 users 行做一次空写，取得 SQLite 写锁。 */
export async function lockAllowanceDay(tx: {user: {updateMany: (args: {where: {id: string}; data: Record<string, never>}) => Promise<{count: number}>}}, userId: string): Promise<void> {
  await tx.user.updateMany({where: {id: userId}, data: {}});
}

export async function readDailyAllowance(userId: string, options: {now?: Date} = {}): Promise<DailyAllowanceView> {
  const now = options.now ?? new Date();
  const [timezone, freeLimit, freeCancelDaily] = await Promise.all([readBillingTimezone(userId), readFreeDailyLimit(userId), readFreeCancelLimit(userId)]);
  const boundary = resolveZonedDayBoundary(now, timezone);
  const row = await db.userDailyAllowance.findUnique({where: {userId_day: {userId, day: boundary.day}}, select: {freeUsed: true, freeReserved: true, freeCancelUsed: true}});
  const freeUsed = row?.freeUsed ?? 0;
  const freeReserved = row?.freeReserved ?? 0;
  const freeCancelUsed = row?.freeCancelUsed ?? 0;
  return {
    day: boundary.day, timezone, freeLimit, freeUsed, freeReserved,
    freeRemaining: Math.max(0, freeLimit - freeUsed - freeReserved),
    freeCancelDaily, freeCancelUsed, freeCancelRemaining: Math.max(0, freeCancelDaily - freeCancelUsed),
    resetAt: boundary.resetAt.toISOString(),
  };
}
