import bcrypt from 'bcryptjs';
import {createHash, randomBytes} from 'node:crypto';
import {db} from '@rumiai/backend/infrastructure/database/client';
import {readAdminAuthorization} from '@rumiai/backend/modules/admin/authorization';
import type {JWTPayload} from '@rumiai/backend/infrastructure/auth/auth';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export class AdminLoginError extends Error {
  constructor(message: string, public status: number) {super(message);}
}

function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }

function parseLogin(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AdminLoginError('登录数据格式不正确。', 400);
  const body = input as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || email.length > 254 || !password || password.length > 200) throw new AdminLoginError('请填写有效邮箱和密码。', 400);
  return {email, password};
}

export async function loginAdminWithPassword(input: unknown) {
  const {email, password} = parseLogin(input);
  const user = await db.user.findUnique({where: {email}});
  if (!user || user.deletedAt || !await bcrypt.compare(password, user.passwordHash)) throw new AdminLoginError('管理员邮箱或密码不正确。', 401);
  if (user.suspendedAt) throw new AdminLoginError('账号已停用，请联系网站客服。', 403);
  const authorization = await readAdminAuthorization(user.id);
  if (!authorization.enabled || authorization.permissions.length === 0) throw new AdminLoginError('当前账号没有管理权限。', 403);
  const raw = randomBytes(48).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.adminSession.deleteMany({where: {expiresAt: {lte: now}}});
  await db.adminSession.create({data: {userId: user.id, tokenHash: hashToken(raw), expiresAt, lastSeenAt: now}});
  return {sessionToken: raw, user: {id: user.id, username: user.username, email: user.email}, permissions: authorization.permissions, roles: authorization.roles, enabled: authorization.enabled, managed: authorization.managed, owner: authorization.owner};
}

export async function getAdminAuthUser(token: string | null): Promise<JWTPayload | null> {
  if (!token) return null;
  const session = await db.adminSession.findUnique({where: {tokenHash: hashToken(token)}, include: {user: {select: {id: true, email: true, deletedAt: true, suspendedAt: true}}}});
  if (!session || session.expiresAt <= new Date() || session.user.deletedAt || session.user.suspendedAt) return null;
  const now = new Date();
  if (session.lastSeenAt.getTime() <= now.getTime() - 5 * 60 * 1000) {
    await db.adminSession.update({where: {id: session.id}, data: {lastSeenAt: now}}).catch(() => {});
  }
  return {userId: session.user.id, email: session.user.email};
}

export async function revokeAdminSession(token: string | null) {
  if (!token) return;
  await db.adminSession.deleteMany({where: {tokenHash: hashToken(token)}});
}

export async function readAdminSessionState(userId: string) {
  const user = await db.user.findUnique({where: {id: userId}, select: {id: true, username: true, email: true, deletedAt: true, suspendedAt: true}});
  const authorization = await readAdminAuthorization(userId);
  if (!user || user.deletedAt || user.suspendedAt || !authorization.enabled || authorization.permissions.length === 0) return null;
  return {user: {id: user.id, username: user.username, email: user.email}, ...authorization};
}
