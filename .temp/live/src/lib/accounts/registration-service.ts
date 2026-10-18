import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { ensureAuthSigningConfiguration } from '@/lib/auth';
import { allocateHandle, isUniqueViolation } from '@/lib/user-identity';
import { recordRegistrationConsents, RegistrationConsentError } from '@/lib/compliance/policy-service';

const MIN_PASSWORD_LENGTH = 6;
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
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) throw new AccountRegistrationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) throw new AccountRegistrationError('Password is too long', 400);

  ensureAuthSigningConfiguration();
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) throw new AccountRegistrationError('Email already in use', 409);

  let username: string;
  if (requestedHandle) {
    if (await db.user.findUnique({ where: { username: requestedHandle }, select: { id: true } })) throw new AccountRegistrationError('Username already in use', 409);
    username = requestedHandle;
  } else {
    username = await allocateHandle(email.split('@')[0]);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    return await db.$transaction(async tx => {
      const user = await tx.user.create({
        data: { username, displayName: displayName || null, email, passwordHash, coins: 100, tier: 'ROOKIE' },
        select: { id: true, username: true, displayName: true, tokenVersion: true, email: true, avatarUrl: true, tier: true, coins: true, streakCount: true, createdAt: true },
      });
      try { await recordRegistrationConsents(tx, user.id, body.consents); }
      catch (error) { if (error instanceof RegistrationConsentError) throw new AccountRegistrationError(error.message, 400); throw error; }
      return user;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AccountRegistrationError('Email or username already in use', 409);
    throw error;
  }
}
