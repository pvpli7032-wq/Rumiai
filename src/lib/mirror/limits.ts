import type {MirrorQuota} from './types';

/**
 * 每日额度计数（V3 §23）。
 *
 * 登录用户按用户维度计一次；匿名用户走两路：浏览器 Cookie 一路，IP 加盐哈希一路，
 * 实际放行取**较严者**（两条路都允许才通过）。IP 原文不落任何地方，内存里只留
 * sha256(盐 + IP) 的前 32 位十六进制。
 *
 * 计数是本进程内的固定窗口，和 rate-limit 一样只对单实例部署成立；换多实例时需要
 * 换成共享存储，不要在这里再叠一层「差不多」的近似。
 */

type Bucket = {day: string; count: number};

const userBuckets = new Map<string, Bucket>();
const cookieBuckets = new Map<string, Bucket>();
const ipBuckets = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(now: number, day: string) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const map of [userBuckets, cookieBuckets, ipBuckets]) {
    for (const [key, bucket] of map) if (bucket.day !== day) map.delete(key);
  }
}

/** 业务日：额度按配置时区切换；只支持整点时区（分钟偏移按最近整点处理）。 */
export function mirrorDayKey(now: Date, timezone: string): string {
  const zone = normalizeTimezone(timezone);
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '01';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function normalizeTimezone(value: string): string {
  try {
    new Intl.DateTimeFormat('en-CA', {timeZone: value});
    return value;
  } catch {
    return 'UTC';
  }
}

function bucketFor(map: Map<string, Bucket>, key: string, day: string): Bucket {
  let bucket = map.get(key);
  if (!bucket || bucket.day !== day) {
    bucket = {day, count: 0};
    map.set(key, bucket);
  }
  return bucket;
}

export type MirrorIdentity = {
  /** 登录用户 id；匿名时为 null。 */
  userId: string | null;
  /** 浏览器 Cookie 主体标识（由服务端签发），匿名时必有。 */
  cookieSubject: string | null;
  /** 浏览器带回来的当日已用次数；服务端重启后仍按它认账。 */
  cookieReportedCount: number;
  /** 已计算好的 IP 加盐哈希；取不到 IP 时为 null。 */
  ipHash: string | null;
};

export type MirrorUsage = {userUsed: number; cookieUsed: number; ipUsed: number};

/** 读取三路已用次数，不做任何写入。Cookie 一路取服务端记忆与浏览器回传中较大者。 */
export function readMirrorUsage(identity: MirrorIdentity, day: string, now = new Date()): MirrorUsage {
  sweep(now.getTime(), day);
  const remembered = identity.cookieSubject ? bucketFor(cookieBuckets, identity.cookieSubject, day).count : 0;
  return {
    userUsed: identity.userId ? bucketFor(userBuckets, identity.userId, day).count : 0,
    cookieUsed: Math.max(remembered, identity.cookieReportedCount),
    ipUsed: identity.ipHash ? bucketFor(ipBuckets, identity.ipHash, day).count : 0,
  };
}

/** 这个身份实际算作已用几次：登录看用户维度，匿名取 Cookie 与 IP 中较严的一路。 */
export function effectiveMirrorUsed(identity: MirrorIdentity, day: string, now = new Date()): number {
  const usage = readMirrorUsage(identity, day, now);
  return identity.userId ? usage.userUsed : Math.max(usage.cookieUsed, usage.ipUsed);
}

export type MirrorLimitDecision =
  | {allowed: true}
  | {allowed: false; channel: 'user' | 'cookie' | 'ip'; used: number; limit: number};

/** 计数并判定。只有放行时才真正加一，所以被拒的请求不会继续抬高计数。 */
export function consumeMirrorLimit(identity: MirrorIdentity, limit: number, day: string, now = new Date()): MirrorLimitDecision {
  const usage = readMirrorUsage(identity, day, now);
  if (identity.userId) {
    if (usage.userUsed >= limit) return {allowed: false, channel: 'user', used: usage.userUsed, limit};
    bucketFor(userBuckets, identity.userId, day).count += 1;
    return {allowed: true};
  }
  if (usage.cookieUsed >= limit) return {allowed: false, channel: 'cookie', used: usage.cookieUsed, limit};
  if (identity.ipHash && usage.ipUsed >= limit) return {allowed: false, channel: 'ip', used: usage.ipUsed, limit};
  if (identity.cookieSubject) bucketFor(cookieBuckets, identity.cookieSubject, day).count += 1;
  if (identity.ipHash) bucketFor(ipBuckets, identity.ipHash, day).count += 1;
  return {allowed: true};
}

/** 生成失败时回退掉本次占用，保证「成功额度只算一次」。 */
export function releaseMirrorLimit(identity: MirrorIdentity, day: string, now = new Date()) {
  sweep(now.getTime(), day);
  const drop = (map: Map<string, Bucket>, key: string | null) => {
    if (!key) return;
    const bucket = map.get(key);
    if (bucket && bucket.day === day && bucket.count > 0) bucket.count -= 1;
  };
  drop(userBuckets, identity.userId);
  drop(cookieBuckets, identity.cookieSubject);
  drop(ipBuckets, identity.ipHash);
}


/** 清空进程内计数。测试要在一个进程里跑多个场景时用它，生产路径不调用。 */
export function resetMirrorLimits() {
  userBuckets.clear();
  cookieBuckets.clear();
  ipBuckets.clear();
  lastSweep = 0;
}

/** 额度视图：给前台展示剩余次数与超额文案。 */
export function mirrorQuotaView(input: {
  identity: MirrorIdentity;
  limit: number;
  overLimitPolicy: 'PAUSE' | 'CHARGE';
  timezone: string;
  purchasable: boolean;
  day?: string;
  now?: Date;
}): MirrorQuota {
  const now = input.now ?? new Date();
  const day = input.day ?? mirrorDayKey(now, input.timezone);
  const used = effectiveMirrorUsed(input.identity, day, now);
  const remaining = Math.max(0, input.limit - used);
  const canGenerate = input.limit > 0 && (remaining > 0 || (input.overLimitPolicy === 'CHARGE' && input.purchasable));
  return {
    anonymous: !input.identity.userId,
    limit: input.limit,
    used,
    remaining,
    overLimitPolicy: input.overLimitPolicy,
    canGenerate,
    blockedReason: canGenerate
      ? null
      : input.limit <= 0
        ? '他眼中的你今天暂停生成，明天再来。'
        : input.overLimitPolicy === 'CHARGE' && !input.purchasable
          ? '今天的次数已用完，购买次数尚未开放，请明天再来。'
          : '今天的次数已用完，明天再来。',
    timezone: input.timezone,
  };
}