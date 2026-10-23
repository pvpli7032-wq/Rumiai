import bcrypt from 'bcryptjs';
import {db} from '@rumiai/backend/infrastructure/database/client';
import {signToken, ensureAuthSigningConfiguration} from '@rumiai/backend/infrastructure/auth/auth';
import {formatUser} from '@rumiai/backend/infrastructure/auth/user-identity';

export class AccountLoginError extends Error {
  constructor(message: string, public status: number) {super(message);}
}
export async function loginWithPassword(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AccountLoginError('登录数据格式不正确。', 400);
  const body = input as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || typeof body.password !== 'string' || !body.password || body.password.length > 200) throw new AccountLoginError('请填写有效邮箱和密码。', 400);
  ensureAuthSigningConfiguration();
  const user = await db.user.findUnique({where: {email}});
  if (!user || user.deletedAt || !await bcrypt.compare(body.password, user.passwordHash)) throw new AccountLoginError('邮箱或密码不正确。', 401);
  if (user.suspendedAt) throw new AccountLoginError('账号已停用，请联系网站客服。', 403);
  const now = new Date();
  const saved = await db.user.updateMany({where: {id: user.id, tokenVersion: user.tokenVersion, deletedAt: null, suspendedAt: null}, data: {lastLoginAt: now, lastActiveAt: now}});
  if (!saved.count) throw new AccountLoginError('账号状态已变化，请重新登录。', 409);
  const token = await signToken({userId: user.id, email: user.email, tokenVersion: user.tokenVersion});
  return {token, user: formatUser({id: user.id, username: user.username, displayName: user.displayName, email: user.email, avatarUrl: user.avatarUrl, tier: user.tier, coins: user.coins, readingMode: user.readingMode, bannedWords: user.bannedWords, shortcuts: user.shortcuts, streakCount: user.streakCount, lastCheckin: user.lastCheckin, createdAt: user.createdAt})};
}
