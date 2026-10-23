import type {MirrorQuota, MirrorQuotaChannel} from '@rumiai/contracts/mirror/types';

/**
 * 每日额度计数（V3 表 9）。
 *
 * 登录用户按用户维度计一次；匿名用户走两条**上限各自独立**的通道：
 * - Cookie 通道：浏览器主体标识，默认 1 次/日（mirror.anonymousDailyLimit）。
 * - IP 通道：同一出口 IP 的加盐哈希，默认 10 次/日（mirror.anonymousIpDailyLimit）。
 * 实际放行取**较严者**：两条通道都还有剩余才通过。IP 原文不落任何地方，
 * 内存里只留 sha256(盐 + IP) 的前 32 位十六进制，盐来自 mirrorIpSalt()。
 *
 * 两条通道都按 billing.dayTimezone 的业务日重置（day 由调用方算好传进来）。
 * 计数是本进程内的固定窗口，和 rate-limit 一样只对单实例部署成立；换多实例时
 * 需要换成共享存储，不要在这里再叠一层「差不多」的近似。
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

/** 三条通道各自的上限。登录只看 userLimit，匿名看 cookieLimit 与 ipLimit。 */
export type MirrorLimitPlan = {
  userLimit: number;
  cookieLimit: number;
  ipLimit: number;
};

export type MirrorUsage = {userUsed: number; cookieUsed: number; ipUsed: number};

/** 读取三路已用次数，不做任何写入。Cookie 一路取服务端记忆与浏览器回传中较大者。 */
export function readMirrorUsage(identity: MirrorIdentity, day: string, now = new Date()): MirrorUsage {
  sweep(now.getTime(), day);
  const remembered = identity.cookieSubject ? bucketFor(cookieBuckets, identity.cookieSubject, day).count : 0;
  return {
    userUsed: identity.userId ? bucketFor(userBuckets, identity.userId, day).count : 0,
    cookieUsed: identity.cookieSubject ? Math.max(remembered, identity.cookieReportedCount) : 0,
    ipUsed: identity.ipHash ? bucketFor(ipBuckets, identity.ipHash, day).count : 0,
  };
}

function channelOf(used: number, limit: number): MirrorQuotaChannel {
  return {used, limit, remaining: Math.max(0, limit - used)};
}

export type MirrorLimitState = {
  /** 生效通道（匿名时是较严的那条）的上限与已用。 */
  limit: number;
  used: number;
  /** 两条通道里更少的剩余。 */
  remaining: number;
  channels: {cookie: MirrorQuotaChannel | null; ip: MirrorQuotaChannel | null};
};

/**
 * 当前额度状态。匿名时取两条通道里剩余更少的一条作为生效通道，
 * 这样前台显示的「剩余次数」就是真正能再生成几次。
 */
export function readMirrorLimitState(identity: MirrorIdentity, plan: MirrorLimitPlan, day: string, now = new Date()): MirrorLimitState {
  const usage = readMirrorUsage(identity, day, now);
  if (identity.userId) {
    const channel = channelOf(usage.userUsed, plan.userLimit);
    return {limit: channel.limit, used: channel.used, remaining: channel.remaining, channels: {cookie: null, ip: null}};
  }
  // 拿不到某一侧标识（没有 Cookie 主体 / 没有 IP）时，那条通道不参与约束。
  const cookie = identity.cookieSubject ? channelOf(usage.cookieUsed, plan.cookieLimit) : null;
  const ip = identity.ipHash ? channelOf(usage.ipUsed, plan.ipLimit) : null;
  const binding = cookie && ip ? (cookie.remaining <= ip.remaining ? cookie : ip) : cookie ?? ip;
  if (!binding) return {limit: plan.cookieLimit, used: 0, remaining: Math.max(0, plan.cookieLimit), channels: {cookie, ip}};
  return {limit: binding.limit, used: binding.used, remaining: binding.remaining, channels: {cookie, ip}};
}

export type MirrorLimitDecision =
  | {allowed: true}
  | {allowed: false; channel: 'user' | 'cookie' | 'ip'; used: number; limit: number};

/**
 * 计数并判定。只有放行时才真正加一，所以被拒的请求不会继续抬高计数。
 * 匿名两条通道都要检查：任意一条到顶就拒绝，并在 channel 里说明是哪一条。
 */
export function consumeMirrorLimit(identity: MirrorIdentity, plan: MirrorLimitPlan, day: string, now = new Date()): MirrorLimitDecision {
  const usage = readMirrorUsage(identity, day, now);
  if (identity.userId) {
    if (usage.userUsed >= plan.userLimit) return {allowed: false, channel: 'user', used: usage.userUsed, limit: plan.userLimit};
    bucketFor(userBuckets, identity.userId, day).count += 1;
    return {allowed: true};
  }
  if (identity.cookieSubject && usage.cookieUsed >= plan.cookieLimit) {
    return {allowed: false, channel: 'cookie', used: usage.cookieUsed, limit: plan.cookieLimit};
  }
  if (identity.ipHash && usage.ipUsed >= plan.ipLimit) {
    return {allowed: false, channel: 'ip', used: usage.ipUsed, limit: plan.ipLimit};
  }
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
  plan: MirrorLimitPlan;
  overLimitPolicy: 'PAUSE' | 'CHARGE';
  timezone: string;
  purchasable: boolean;
  purchase: MirrorQuota['purchase'];
  day?: string;
  now?: Date;
}): MirrorQuota {
  const now = input.now ?? new Date();
  const day = input.day ?? mirrorDayKey(now, input.timezone);
  const state = readMirrorLimitState(input.identity, input.plan, day, now);
  const canGenerate = state.remaining > 0 || (input.overLimitPolicy === 'CHARGE' && input.purchasable);
  return {
    anonymous: !input.identity.userId,
    limit: state.limit,
    used: state.used,
    remaining: state.remaining,
    overLimitPolicy: input.overLimitPolicy,
    canGenerate,
    blockedReason: canGenerate ? null : blockedReasonOf(input),
    timezone: input.timezone,
    purchase: input.purchase,
    channels: state.channels,
  };
}

function blockedReasonOf(input: {plan: MirrorLimitPlan; identity: MirrorIdentity; overLimitPolicy: 'PAUSE' | 'CHARGE'; purchasable: boolean}): string {
  // 上限为 0 是「暂停」而不是「用完了」：运营把次数关掉时文案要说清楚。
  const paused = input.identity.userId
    ? input.plan.userLimit <= 0
    : input.plan.cookieLimit <= 0 || input.plan.ipLimit <= 0;
  if (paused) return '他眼中的你今天暂停生成，明天再来。';
  if (input.overLimitPolicy === 'CHARGE' && !input.purchasable) return '今天的次数已用完，购买次数尚未开放，明天再来。';
  return '今天的次数已用完，明天再来。';
}
