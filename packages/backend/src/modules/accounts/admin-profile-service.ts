import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {hasAdminPermission} from '@rumiai/backend/modules/admin/authorization';
import {recordAdminAudit} from '@rumiai/backend/modules/admin/management-service';
import {mayAttachAccountUpload} from '@rumiai/backend/modules/uploads/read-service';
import {validateUsername} from '@rumiai/backend/infrastructure/auth/user-identity';
import {validateAvatarUrl, AVATAR_URL_MAX_LENGTH} from '@rumiai/backend/modules/uploads/url-validation';

export class AdminProfileError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const profileSelect = {
  id: true, username: true, displayName: true, avatarUrl: true, email: true,
  tier: true, coins: true, accountVersion: true, deletedAt: true,
} as const;

function object(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AdminProfileError('资料数据格式错误。');
  return input as Record<string, unknown>;
}

function version(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new AdminProfileError('版本信息无效。');
  return value as number;
}

function reason(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 300) throw new AdminProfileError('请填写 1–300 字操作理由。');
  return value.trim();
}

function text(value: unknown, label: string, max: number) {
  if (typeof value !== 'string') throw new AdminProfileError(`${label}格式错误。`);
  const result = value.trim();
  if (!result || result.length > max) throw new AdminProfileError(`${label}不能为空且不能超过 ${max} 字。`);
  return result;
}

async function readProfile(tx: Prisma.TransactionClient, id: string) {
  const user = await tx.user.findUnique({where: {id}, select: profileSelect});
  if (!user) throw new AdminProfileError('用户不存在。', 404);
  if (user.deletedAt) throw new AdminProfileError('已注销用户不能修改资料。', 409);
  return user;
}

/** Read the editable user profile without returning chat, ledger, or private activity data. */
export async function readManagedProfile(actorId: string, userId: string) {
  if (!await hasAdminPermission(actorId, 'accounts.read')) throw new AdminProfileError('当前账号没有用户管理查看权限。', 403);
  await pragmasReady;
  return db.user.findUnique({where: {id: userId}, select: profileSelect}).then(user => {
    if (!user) throw new AdminProfileError('用户不存在。', 404);
    return user;
  });
}

/** Update only public identity fields; email, tier, coins, and account state are deliberately out of scope. */
export async function updateManagedProfile(actorId: string, userId: string, input: unknown) {
  const body = object(input);
  const expected = version(body.version);
  const explanation = reason(body.reason);
  const allowed = new Set(['username', 'displayName', 'avatarUrl', 'version', 'reason']);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new AdminProfileError('资料修改字段无效。');

  const username = body.username === undefined ? undefined : text(body.username, '用户名', 100);
  if (username !== undefined) { const usernameError = validateUsername(username); if (usernameError) throw new AdminProfileError(usernameError); }
  const displayName = body.displayName === undefined ? undefined : text(body.displayName, '昵称', 100);
  let avatarUrl: string | null | undefined;
  if (body.avatarUrl !== undefined) {
    if (body.avatarUrl === null || body.avatarUrl === '') avatarUrl = null;
    else {
      if (typeof body.avatarUrl !== 'string' || body.avatarUrl.length > AVATAR_URL_MAX_LENGTH) throw new AdminProfileError(`头像地址格式错误或超过 ${AVATAR_URL_MAX_LENGTH} 字。`);
      const avatarError = validateAvatarUrl(body.avatarUrl);
      if (avatarError) throw new AdminProfileError(avatarError);
      avatarUrl = body.avatarUrl.trim();
      if (avatarUrl.startsWith('/uploads/')) {
        const canAttach = await mayAttachAccountUpload(userId, avatarUrl, {allowSiteOwned: true});
        if (!canAttach) throw new AdminProfileError('头像上传素材不属于此用户或站点。');
      }
    }
  }
  if (username === undefined && displayName === undefined && avatarUrl === undefined) throw new AdminProfileError('至少修改一项资料。');

  await pragmasReady;
  return db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE users SET account_version = account_version WHERE id = ${actorId}`;
    if (!await hasAdminPermission(actorId, 'accounts.manage', tx)) throw new AdminProfileError('当前账号没有用户资料修改权限。', 403);
    const before = await readProfile(tx, userId);
    if (before.accountVersion !== expected) throw new AdminProfileError('用户资料已被其他人修改，请刷新后重试。', 409);
    const data: Prisma.UserUpdateInput = {
      ...(username !== undefined ? {username} : {}),
      ...(displayName !== undefined ? {displayName} : {}),
      ...(avatarUrl !== undefined ? {avatarUrl} : {}),
      accountVersion: {increment: 1},
    };
    try {
      const changed = await tx.user.updateMany({where: {id: userId, accountVersion: expected, deletedAt: null}, data});
      if (changed.count !== 1) throw new AdminProfileError('用户资料已被其他人修改，请刷新后重试。', 409);
    } catch (error) {
      if (error instanceof AdminProfileError) throw error;
      if ((error as {code?: unknown})?.code === 'P2002') throw new AdminProfileError('用户名已被占用。', 409);
      throw error;
    }
    const after = await tx.user.findUniqueOrThrow({where: {id: userId}, select: profileSelect});
    await recordAdminAudit(tx, actorId, 'ACCOUNT_PROFILE_UPDATE', userId, explanation, {
      before: {username: before.username, displayName: before.displayName, avatarUrl: before.avatarUrl, version: before.accountVersion},
      after: {username: after.username, displayName: after.displayName, avatarUrl: after.avatarUrl, version: after.accountVersion},
    });
    return after;
  });
}
