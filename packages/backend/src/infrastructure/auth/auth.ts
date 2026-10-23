import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '@rumiai/backend/infrastructure/database/client';
import { readSettingValue } from '@rumiai/backend/modules/settings/service';
import {logActivityStorageUnavailable,recordUserActivityDay} from '@rumiai/backend/modules/analytics/activity-service';

/**
 * The development fallback is a literal in this repository, so anyone could forge
 * a token for any account if it were ever used in production. Refuse to start
 * signing with it there instead of failing silently.
 */
const DEV_JWT_SECRET = 'xingban-dev-placeholder-do-not-use';
/** Anything short enough to brute-force is not a secret. */
const MIN_SECRET_LENGTH = 32;
export class AuthConfigurationError extends Error {
  readonly code = 'AUTH_CONFIG';
  constructor(message: string) { super(message); this.name = 'AuthConfigurationError'; }
}
const PUBLISHED_SECRETS = new Set([
  DEV_JWT_SECRET,
  // Pre-rename development literal. It shipped in this file and in the public repo,
  // so it stays banned even though it is no longer the fallback.
  'khuiai-secret-jwt-key-2026',
  'replace-with-a-random-secret-at-least-32-characters',
  'ci-only-secret-not-used-anywhere-else-000000',
]);

function resolveSecret(): string {
  const configured = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) return configured || DEV_JWT_SECRET;

  // Checking only for an unset variable was not enough: .env files in this project
  // have been found carrying the development literal itself, which is published in
  // this file and would let anyone forge a token for any account.
  if (!configured?.trim()) {
    throw new AuthConfigurationError('JWT_SECRET must be set in production — refusing to use the development fallback');
  }
  if (PUBLISHED_SECRETS.has(configured.trim())) {
    throw new AuthConfigurationError('JWT_SECRET is a published example value — set a unique random secret');
  }
  if (configured.length < MIN_SECRET_LENGTH) {
    throw new AuthConfigurationError(`JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production`);
  }
  return configured;
}

export function ensureAuthSigningConfiguration() { resolveSecret(); }

function base64urlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64urlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

export interface JWTPayload {
  userId: string;
  email: string;
  /** User.tokenVersion when the token was issued; logout bumps it to revoke. */
  tv?: number;
  iat?: number;
  exp?: number;
}

export async function signToken(payload: {
  userId: string;
  email: string;
  tokenVersion?: number;
}): Promise<string> {
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  // 登录有效期读设置中心（accounts.sessionDays）：后台改完，下一个签发的令牌就按新天数。
  // 读失败按 7 天兜底，绝不让登录因为设置读不到而失败。
  const sessionDays = await readSettingValue<number>('accounts.sessionDays').catch(() => 7);
  const claims = base64urlEncode(
    JSON.stringify({
      userId: payload.userId,
      email: payload.email,
      tv: payload.tokenVersion ?? 0,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * sessionDays,
    })
  );
  const signature = createHmac('sha256', resolveSecret())
    .update(`${header}.${claims}`)
    .digest('base64url');
  return `${header}.${claims}.${signature}`;
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  const [header, claims, signature] = parts;
  const expectedSig = createHmac('sha256', resolveSecret())
    .update(`${header}.${claims}`)
    .digest('base64url');

  // Constant-time compare: a plain !== leaks how much of the signature matched.
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSig);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error('Invalid token signature');
  }

  const decoded = JSON.parse(base64urlDecode(claims)) as JWTPayload;
  if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  return decoded;
}

/**
 * Resolve the caller from the Authorization header.
 *
 * This costs one indexed lookup per authenticated request, which buys two things a
 * self-contained JWT cannot give: logout that actually revokes (the token carries
 * the tokenVersion it was signed with, and logout bumps the stored one), and
 * immediate rejection of tokens belonging to a deleted account.
 */
export async function getAuthUser(request: Request): Promise<JWTPayload | null> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return null;

    const payload = await verifyToken(authHeader.slice(7));

    const user = await db.user.findUnique({
      where: { id: payload.userId },
      select: { tokenVersion: true, deletedAt: true, suspendedAt: true, lastActiveAt: true },
    });
    if (!user || user.deletedAt || user.suspendedAt) return null;
    if ((payload.tv ?? 0) !== user.tokenVersion) return null;

    try { await recordUserActivityDay(payload.userId); }
    catch { logActivityStorageUnavailable(); }

    const cutoff = new Date(Date.now() - 300000);
    if (!user.lastActiveAt || user.lastActiveAt < cutoff) await db.user.updateMany({where: {id: payload.userId, tokenVersion: user.tokenVersion, deletedAt: null, suspendedAt: null, OR: [{lastActiveAt: null}, {lastActiveAt: {lt: cutoff}}]}, data: {lastActiveAt: new Date()}});
    return payload;
  } catch {
    return null;
  }
}
