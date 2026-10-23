import bcrypt from 'bcryptjs';
import {createHash, randomBytes} from 'node:crypto';
import {db} from '@rumiai/backend/infrastructure/database/client';
import {accountEmailDelivery, type AccountEmailDelivery, type AccountEmailPurpose} from '@rumiai/backend/infrastructure/email/account-email-delivery';
import {readRegistrationRules} from '@rumiai/backend/modules/settings';

const RESET_TTL_MS = 15 * 60_000;
const VERIFY_TTL_MS = 24 * 60 * 60_000;
const ACTIVATE_TTL_MS = 24 * 60 * 60_000;
const MAX_PASSWORD_BYTES = 72;

export class AccountRecoveryError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = 'AccountRecoveryError'; }
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function issue(user: {id: string; email: string}, purpose: AccountEmailPurpose, ttlMs: number, delivery: AccountEmailDelivery) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  await db.$transaction(async tx => {
    await tx.accountActionToken.updateMany({where: {userId: user.id, purpose, usedAt: null}, data: {usedAt: now}});
    await tx.accountActionToken.create({data: {userId: user.id, purpose, tokenHash: digest(token), expiresAt}});
  });
  await delivery.deliver({email: user.email, purpose, token, expiresAt});
}

/** Always resolves the same way for known and unknown addresses to prevent enumeration. */
export async function requestPasswordReset(emailInput: unknown, delivery = accountEmailDelivery()): Promise<void> {
  const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
  if (!email) return;
  const user = await db.user.findFirst({where: {email, deletedAt: null}, select: {id: true, email: true}});
  if (user) await issue(user, 'PASSWORD_RESET', RESET_TTL_MS, delivery);
}

export async function resetPassword(tokenInput: unknown, passwordInput: unknown): Promise<void> {
  const token = typeof tokenInput === 'string' ? tokenInput.trim() : '';
  const password = typeof passwordInput === 'string' ? passwordInput : '';
  const rules = await readRegistrationRules();
  if (!token || password.length < rules.passwordMinLength || Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new AccountRecoveryError(`链接无效或新密码不符合要求（至少 ${rules.passwordMinLength} 位）。`);
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();
  const record = await db.accountActionToken.findUnique({where: {tokenHash: digest(token)}, select: {id: true, userId: true, purpose: true, usedAt: true, expiresAt: true}});
  if (!record || record.purpose !== 'PASSWORD_RESET' || record.usedAt || record.expiresAt <= now) throw new AccountRecoveryError('链接无效或已过期，请重新申请。');

  const claimed = await db.$transaction(async tx => {
    const claim = await tx.accountActionToken.updateMany({where: {id: record.id, usedAt: null, expiresAt: {gt: now}}, data: {usedAt: now}});
    if (claim.count !== 1) return false;
    await tx.user.update({where: {id: record.userId}, data: {passwordHash, tokenVersion: {increment: 1}}});
    await tx.adminSession.deleteMany({where: {userId: record.userId}});
    return true;
  });
  if (!claimed) throw new AccountRecoveryError('链接无效或已过期，请重新申请。');
}

export async function requestEmailVerification(userId: string, delivery = accountEmailDelivery()): Promise<void> {
  const user = await db.user.findFirst({where: {id: userId, deletedAt: null}, select: {id: true, email: true, emailVerifiedAt: true}});
  if (user && !user.emailVerifiedAt) await issue(user, 'EMAIL_VERIFICATION', VERIFY_TTL_MS, delivery);
}

export async function verifyEmail(tokenInput: unknown): Promise<void> {
  const token = typeof tokenInput === 'string' ? tokenInput.trim() : '';
  const now = new Date();
  const record = token ? await db.accountActionToken.findUnique({where: {tokenHash: digest(token)}, select: {id: true, userId: true, purpose: true, usedAt: true, expiresAt: true}}) : null;
  if (!record || record.purpose !== 'EMAIL_VERIFICATION' || record.usedAt || record.expiresAt <= now) throw new AccountRecoveryError('验证链接无效或已过期，请重新申请。');
  const claimed = await db.$transaction(async tx => {
    const claim = await tx.accountActionToken.updateMany({where: {id: record.id, usedAt: null, expiresAt: {gt: now}}, data: {usedAt: now}});
    if (claim.count !== 1) return false;
    await tx.user.update({where: {id: record.userId}, data: {emailVerifiedAt: now}});
    return true;
  });
  if (!claimed) throw new AccountRecoveryError('验证链接无效或已过期，请重新申请。');
}

export async function requestAccountActivation(userId: string, delivery = accountEmailDelivery()): Promise<void> {
  const user = await db.user.findFirst({where: {id: userId, deletedAt: null}, select: {id: true, email: true}});
  if (!user) throw new AccountRecoveryError('待激活账号不存在。', 404);
  await issue(user, 'ACCOUNT_ACTIVATION', ACTIVATE_TTL_MS, delivery);
}

export async function activateAccount(tokenInput: unknown, passwordInput: unknown): Promise<void> {
  const token = typeof tokenInput === 'string' ? tokenInput.trim() : '';
  const password = typeof passwordInput === 'string' ? passwordInput : '';
  const rules = await readRegistrationRules();
  if (!token || password.length < rules.passwordMinLength || Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) throw new AccountRecoveryError(`激活链接无效或密码不符合要求（至少 ${rules.passwordMinLength} 位）。`);
  const passwordHash = await bcrypt.hash(password, 10), now = new Date();
  const record = await db.accountActionToken.findUnique({where: {tokenHash: digest(token)}});
  if (!record || record.purpose !== 'ACCOUNT_ACTIVATION' || record.usedAt || record.expiresAt <= now) throw new AccountRecoveryError('激活链接无效或已过期。');
  const claimed = await db.$transaction(async tx => {
    const claim = await tx.accountActionToken.updateMany({where: {id: record.id, usedAt: null, expiresAt: {gt: now}}, data: {usedAt: now}});
    if (claim.count !== 1) return false;
    await tx.user.update({where: {id: record.userId}, data: {passwordHash, suspendedAt: null, suspensionReason: null, emailVerifiedAt: now, tokenVersion: {increment: 1}, accountVersion: {increment: 1}}});
    await tx.adminSession.deleteMany({where: {userId: record.userId}});
    return true;
  });
  if (!claimed) throw new AccountRecoveryError('激活链接无效或已过期。');
}
