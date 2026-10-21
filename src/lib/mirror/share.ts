import {createHash, createHmac, randomBytes, timingSafeEqual} from 'crypto';
import {MIRROR_QUOTA_COOKIE, type MirrorOwnerResult, type MirrorPublicResult} from './types';

/**
 * 分享与匿名归属。
 *
 * - 匿名创建时的归属凭据是一个 HttpOnly Cookie：随机主体标识 + 服务端 HMAC 签名，
 *   签名里带上这条结果的 shareId，所以凭据只对它被签发的那条结果有效，不能拿来删
 *   别人的结果。
 * - IP 原文从不落库：只保存 sha256(盐 + IP)，盐取环境变量里配置的口令。
 * - 分享视图只读结果字段（称号/三条观察/金句/两个指数），三题原回答永远不会出现在
 *   公开响应里。
 */

const DEV_IP_SALT = 'xingban-dev-mirror-ip-salt';

/**
 * IP 盐。优先用专门的 MIRROR_IP_SALT；没配就复用 JWT_SECRET（生产环境强制存在且足够随机），
 * 这样即使运维漏配，加盐哈希也不会退化成「用公开常量算 IPv4」，彩虹表反推不成立。
 * 开发环境最后才落到固定占位值，保证本地行为可复现。
 */
export function mirrorIpSalt(env: Record<string, string | undefined> = process.env): string {
  return env.MIRROR_IP_SALT?.trim() || env.JWT_SECRET?.trim() || DEV_IP_SALT;
}

/** 只留前 32 位十六进制，足够区分且不必保存整段摘要。 */
export function hashMirrorIp(ip: string | null | undefined, salt: string): string | null {
  const value = ip?.trim();
  if (!value) return null;
  return createHash('sha256').update(`${salt}|${value}`).digest('hex').slice(0, 32);
}

/** 归属凭据签名。环境里的 JWT_SECRET 在开发环境有已公开的占位值，这里只在配置了才复用。 */
function attributionSecret(env: Record<string, string | undefined> = process.env): string {
  return env.MIRROR_ATTRIBUTION_SECRET?.trim() || env.JWT_SECRET?.trim() || DEV_IP_SALT;
}

export function newMirrorSubject(): string {
  return randomBytes(18).toString('base64url');
}

export function signMirrorAttribution(subject: string, shareId: string, env: Record<string, string | undefined> = process.env): string {
  return createHmac('sha256', attributionSecret(env)).update(`${subject}:${shareId}`).digest('base64url').slice(0, 32);
}

export function verifyMirrorAttribution(input: {subject: string | null; shareId: string; token: string | null}, env: Record<string, string | undefined> = process.env): boolean {
  if (!input.subject || !input.token) return false;
  const expected = Buffer.from(signMirrorAttribution(input.subject, input.shareId, env));
  const actual = Buffer.from(input.token);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** 归属凭据 Cookie 名：每条结果一个，上限由路由负责不无限增长。 */
export function mirrorAttributionCookieName(shareId: string): string {
  return `xb_mirror_owner_${shareId}`;
}

/** 从 Cookie 头里读一个值；只做解码，不做语义判断。 */
export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** 浏览器回传的当日用量（`日期:次数`），原样解析；是否算数由调用方按业务日判断。 */
export function readMirrorQuotaCookie(header: string | null): {day: string | null; count: number} {
  const [rawDay, rawCount] = (readCookie(header, MIRROR_QUOTA_COOKIE) ?? '').split(':');
  const count = Number.parseInt(rawCount ?? '', 10);
  return {
    day: rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : null,
    count: Number.isSafeInteger(count) && count > 0 ? count : 0,
  };
}

export type MirrorRow = {
  shareId: string;
  userId: string | null;
  anonymousSubject: string | null;
  characterId: string;
  title: string;
  observationsJson: string;
  quote: string;
  indicesJson: string;
  status: string;
  createdAt: Date;
  expiresAt: Date | null;
};

type MirrorCharacterView = {id: string; name: string; avatarUrl: string | null};

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 结果是否仍可读：状态为 READY 且未过期。删除写在 status 上，所以删除后就是 404。 */
export function isMirrorReadable(row: Pick<MirrorRow, 'status' | 'expiresAt'>, now = new Date()): boolean {
  return row.status === 'READY' && (!row.expiresAt || row.expiresAt > now);
}

/**
 * 公开视图：只有结果字段，没有回答，也没有归属标识。
 *
 * V3 §23「公开分享只带用户确认的结果，不自动展示三题原回答」的依据就在这里：
 * 1) 返回类型是 MirrorPublicResult，结构里没有 answers 字段，构造时也只逐字段挑值；
 * 2) 三题原回答只由下面的 toOwnerResult 附加，而它唯一的调用点是 repository 里
 *    canReadMirrorAnswers（口径与删除权一致：登录本人，或持创建时归属凭据的匿名浏览器）；
 * 3) 分享页/分享接口走的都是 readMirrorResult 的 public 分支，拿到的就是这个函数的返回值。
 * 因此陌生人打开分享链接永远读不到回答，不需要额外的过滤步骤。
 */
export function toPublicResult(row: MirrorRow, character: MirrorCharacterView): MirrorPublicResult | null {
  const observations = parseJson<string[]>(row.observationsJson);
  const indices = parseJson<{atmosphere?: unknown; rapport?: unknown}>(row.indicesJson);
  if (!Array.isArray(observations) || observations.length !== 3 || !indices) return null;
  return {
    shareId: row.shareId,
    title: row.title,
    observations: [observations[0], observations[1], observations[2]],
    quote: row.quote,
    indices: {atmosphere: Number(indices.atmosphere) || 0, rapport: Number(indices.rapport) || 0},
    characterId: character.id,
    characterName: character.name,
    characterAvatarUrl: character.avatarUrl,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}

/** 本人视图：在公开字段之外附加三题原回答与删除权。 */
export function toOwnerResult(publicResult: MirrorPublicResult, answers: string[], canDelete: boolean): MirrorOwnerResult {
  return {...publicResult, answers, canDelete};
}

/** 读取者身份：登录 id，或匿名 Subject 头（服务端 Cookie 解出来的随机标识）。 */
export type MirrorViewer = {userId: string | null; subject: string | null};

/**
 * 谁能删：登录本人，或创建时签发了归属凭据的匿名浏览器。
 * 注意这里不认「同一个 IP」——IP 是共享的，不能作为归属依据。
 */
export function canDeleteMirrorResult(input: {row: Pick<MirrorRow, 'userId' | 'anonymousSubject'>; viewer: MirrorViewer; attributionValid: boolean}): boolean {
  if (input.row.userId) return Boolean(input.viewer.userId && input.viewer.userId === input.row.userId);
  return Boolean(input.attributionValid && input.viewer.subject && input.viewer.subject === input.row.anonymousSubject);
}

/** 是否本人能看到三题原回答：口径与删除权一致。 */
export function canReadMirrorAnswers(input: {row: Pick<MirrorRow, 'userId' | 'anonymousSubject'>; viewer: MirrorViewer; attributionValid: boolean}): boolean {
  return canDeleteMirrorResult(input);
}
