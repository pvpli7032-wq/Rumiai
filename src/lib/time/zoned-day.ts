/**
 * 时区里的「业务日」计算。
 *
 * 为什么单独成模块：日额度（billing）与每日调用上限（ai_usage）都按 billing.dayTimezone
 * 切日，而这两个域不允许互相 import（billing 只依赖 settings/coins/ai）。把纯日期换算放在
 * 这里，两边共用一份实现，不会出现两套时区口径。
 *
 * 这里只有 Intl 与算术，不碰数据库、不读环境变量，可以在任何运行时调用。
 */

export interface DayBoundary {
  /** 业务日 'YYYY-MM-DD'。 */
  day: string;
  /** 业务日结束（下一个业务日 00:00）的绝对时刻。 */
  resetAt: Date;
}

interface ZonedParts {year: number; month: number; day: number; hour: number; minute: number; second: number}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  // 非法时区在这里抛 RangeError，由调用方决定回落值；不要静默当成 UTC。
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  formatterCache.set(timezone, created);
  return created;
}

export function isValidTimezone(timezone: string): boolean {
  try { formatter(timezone); return true; } catch { return false; }
}

/** 某个绝对时刻在指定时区里「年月日时分秒」各是多少。 */
function zonedParts(instant: number, timezone: string): ZonedParts {
  const parts = formatter(timezone).formatToParts(new Date(instant));
  const read = (type: string) => Number(parts.find(part => part.type === type)?.value);
  const value = {year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute'), second: read('second')};
  if (!Object.values(value).every(Number.isInteger)) throw new RangeError('无法解析时区 ' + timezone);
  return value;
}

/** 时区相对 UTC 的偏移（毫秒）。 */
function zoneOffsetMs(instant: number, timezone: string): number {
  const {year, month, day, hour, minute, second} = zonedParts(instant, timezone);
  return Date.UTC(year, month - 1, day, hour, minute, second) - Math.floor(instant / 1000) * 1000;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function resolveZonedDay(now: Date, timezone: string): string {
  const {year, month, day} = zonedParts(now.getTime(), timezone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** 「时区里的某天 00:00」对应的绝对时刻；两次迭代覆盖夏令时切换。 */
function startOfZonedDay(year: number, month: number, day: number, timezone: string): number {
  const wallClock = Date.UTC(year, month - 1, day, 0, 0, 0);
  let instant = wallClock - zoneOffsetMs(wallClock, timezone);
  for (let attempt = 0; attempt < 2; attempt += 1) instant = wallClock - zoneOffsetMs(instant, timezone);
  return instant;
}

export function resolveZonedDayBoundary(now: Date, timezone: string): DayBoundary {
  const {year, month, day} = zonedParts(now.getTime(), timezone);
  // Date.UTC 会自动进位到下个月/下一年，跨月跨年不用特判。
  const resetAt = startOfZonedDay(year, month, day + 1, timezone);
  return {day: `${year}-${pad(month)}-${pad(day)}`, resetAt: new Date(resetAt)};
}
