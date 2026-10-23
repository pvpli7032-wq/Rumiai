import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { ensureAuthSigningConfiguration } from '@/lib/auth';
import { allocateHandle, isUniqueViolation, validateUsername } from '@/lib/user-identity';
import { recordRegistrationConsents, RegistrationConsentError } from '@/lib/compliance/policy-service';
import { readRegistrationRules } from '@/lib/settings';
import { readInviteSettings, resolveInviterId } from '@/lib/growth/invite-service';
import { recordProductEvent } from '@/lib/analytics/product-events';

/** 72 是 bcrypt 的输入上限，属于算法约束，不是运营参数。 */
const MAX_PASSWORD_BYTES = 72;

export class AccountRegistrationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'AccountRegistrationError';
  }
}

export async function registerAccount(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AccountRegistrationError('注册数据格式不正确。', 400);
  const body = input as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body.password;
  const requestedHandle = typeof body.username === 'string' ? body.username.trim() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : typeof body.name === 'string' ? body.name.trim() : '';

  if (!email || !password || (!requestedHandle && !displayName)) throw new AccountRegistrationError('Missing required fields', 400);
  // 密码位数与注册赠币都由设置中心决定，改完下一次注册就生效。
  const rules = await readRegistrationRules();
  if (typeof password !== 'string' || password.length < rules.passwordMinLength) throw new AccountRegistrationError(`Password must be at least ${rules.passwordMinLength} characters`, 400);
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) throw new AccountRegistrationError('Password is too long', 400);

  ensureAuthSigningConfiguration();
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) throw new AccountRegistrationError('Email already in use', 409);

  let username: string;
  if (requestedHandle) {
    const usernameError = validateUsername(requestedHandle);
    if (usernameError) throw new AccountRegistrationError(usernameError, 400);
    if (await db.user.findUnique({ where: { username: requestedHandle }, select: { id: true } })) throw new AccountRegistrationError('Username already in use', 409);
    username = requestedHandle;
  } else {
    username = await allocateHandle(email.split('@')[0]);
  }

  // 邀请码写错不能让注册失败：解析不出来就当没有邀请人（V3 表 22 记录分享来源）。
  const invite = await readInviteSettings();
  const inviterId = invite.enabled ? await resolveInviterId(typeof body.inviteCode === 'string' ? body.inviteCode : null, '') : null;

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    return await db.$transaction(async tx => {
      const user = await tx.user.create({
        data: { username, displayName: displayName || null, email, passwordHash, coins: rules.signupBonusCoins, tier: 'ROOKIE', invitedByUserId: inviterId },
        select: { id: true, username: true, displayName: true, tokenVersion: true, email: true, avatarUrl: true, tier: true, coins: true, streakCount: true, createdAt: true },
      });
      try { await recordRegistrationConsents(tx, user.id, body.consents); }
      catch (error) { if (error instanceof RegistrationConsentError) throw new AccountRegistrationError(error.message, 400); throw error; }
      // 邀请漏斗：有归属才记一条，埋点失败不影响注册（V3 表 22 邀请与分享）。
      if (inviterId) void recordProductEvent({event: 'invite_registered', userId: user.id, subjectKey: inviterId});
      return user;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AccountRegistrationError('Email or username already in use', 409);
    throw error;
  }
}
