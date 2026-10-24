import {randomBytes} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@rumiai/backend/infrastructure/database/client';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

export class ReferralError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'REFERRAL_INVALID') {super(message); this.name = 'ReferralError';}
}

function randomCode() {
  const bytes = randomBytes(CODE_LENGTH);
  return Array.from(bytes, value => ALPHABET[value % ALPHABET.length]).join('');
}

function normalizeCode(value: unknown) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  // Generated codes use the unambiguous alphabet; accept the older 6–32 char
  // alphanumeric format so deployed links remain valid during migration.
  if (!/^[A-Z0-9]{6,32}$/.test(code)) throw new ReferralError('邀请码无效（格式不正确）。');
  return code;
}

export async function ensureActiveInviteCode(userId: string) {
  await pragmasReady;
  const existing = await db.inviteCode.findUnique({where: {ownerId: userId}});
  if (existing) return existing;
  const legacy = await db.user.findUnique({where: {id: userId}, select: {inviteCode: true}});
  if (legacy?.inviteCode) return db.inviteCode.upsert({where: {code: legacy.inviteCode}, update: {}, create: {ownerId: userId, code: legacy.inviteCode}});
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    try {
      const created = await db.inviteCode.create({data: {ownerId: userId, code}});
      await db.user.updateMany({where: {id: userId, inviteCode: null}, data: {inviteCode: code}});
      return created;
    } catch (error) {
      if (typeof error === 'object' && error && (error as {code?: string}).code === 'P2002') {
        const winner = await db.inviteCode.findUnique({where: {ownerId: userId}});
        if (winner) return winner;
        continue;
      }
      throw error;
    }
  }
  throw new ReferralError('邀请码生成失败，请稍后重试。', 503);
}

export async function updateInviteCode(userId: string, input: {id: string; version: number; enabled: boolean; expiresAt?: string | null; maxUses?: number | null}) {
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (!input.id || !Number.isSafeInteger(input.version) || typeof input.enabled !== 'boolean' || (expiresAt && !Number.isFinite(expiresAt.getTime())) || (input.maxUses !== null && input.maxUses !== undefined && (!Number.isSafeInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > 1_000_000))) throw new ReferralError('邀请码配置无效。');
  return db.$transaction(async tx => {
    const before = await tx.inviteCode.findFirst({where: {id: input.id, ownerId: userId}});
    if (!before) throw new ReferralError('邀请码不存在。', 404);
    if (before.version !== input.version) throw new ReferralError('邀请码已更新，请刷新后重试。', 409, 'VERSION_CONFLICT');
    if (input.maxUses !== null && input.maxUses !== undefined && input.maxUses < before.usedCount) throw new ReferralError('使用上限不能低于已使用次数。');
    const changed = await tx.inviteCode.updateMany({where: {id: before.id, version: before.version}, data: {status: input.enabled ? 'ACTIVE' : 'DISABLED', disabledAt: input.enabled ? null : new Date(), expiresAt, maxUses: input.maxUses ?? null, version: {increment: 1}}});
    if (changed.count !== 1) throw new ReferralError('邀请码已更新，请刷新后重试。', 409, 'VERSION_CONFLICT');
    return tx.inviteCode.findUniqueOrThrow({where: {id: before.id}});
  });
}

export async function resolveInvitation(codeInput: unknown) {
  const code = normalizeCode(codeInput);
  const now = new Date();
  let invite = await db.inviteCode.findUnique({where: {code}, include: {owner: {select: {id: true, deletedAt: true, suspendedAt: true}}}});
  if (!invite) {
    const legacy = await db.user.findUnique({where: {inviteCode: code}, select: {id: true, deletedAt: true, suspendedAt: true}});
    if (legacy && !legacy.deletedAt && !legacy.suspendedAt) invite = await db.inviteCode.create({data: {ownerId: legacy.id, code}, include: {owner: {select: {id: true, deletedAt: true, suspendedAt: true}}}});
  }
  if (!invite) throw new ReferralError('邀请码无效，请核对后重试。', 400, 'INVITE_INVALID');
  if (invite.status !== 'ACTIVE' || invite.owner.deletedAt || invite.owner.suspendedAt || (invite.expiresAt && invite.expiresAt <= now) || (invite.maxUses !== null && invite.usedCount >= invite.maxUses)) throw new ReferralError('邀请码已停用、已过期或已达到使用上限。', 409, 'INVITE_UNAVAILABLE');
  return {id: invite.id, ownerId: invite.ownerId, code: invite.code};
}

async function assertNoCycle(tx: Prisma.TransactionClient, inviterId: string, inviteeId: string) {
  if (inviterId === inviteeId) throw new ReferralError('不能使用自己的邀请码。', 409, 'SELF_INVITE');
  let cursor: string | null = inviterId;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === inviteeId) throw new ReferralError('邀请关系不能形成环路。', 409, 'REFERRAL_CYCLE');
    if (visited.has(cursor)) throw new ReferralError('现有邀请关系异常，已阻止绑定。', 409, 'REFERRAL_CYCLE');
    visited.add(cursor);
    const parent: {inviterId: string} | null = await tx.referralRelationship.findUnique({where: {inviteeId: cursor}, select: {inviterId: true}});
    cursor = parent?.inviterId ?? null;
  }
}

/** Consume one code and bind one direct parent in the caller's registration transaction. */
export async function bindReferralInTransaction(tx: Prisma.TransactionClient, input: {inviteCode: string; inviteeId: string}) {
  const code = normalizeCode(input.inviteCode);
  const prior = await tx.referralRelationship.findUnique({where: {inviteeId: input.inviteeId}});
  if (prior) throw new ReferralError('该账号已经绑定邀请关系，不能重复绑定。', 409, 'ALREADY_BOUND');
  const invite = await tx.inviteCode.findUnique({where: {code}});
  const now = new Date();
  if (!invite || invite.status !== 'ACTIVE' || (invite.expiresAt && invite.expiresAt <= now)) throw new ReferralError('邀请码无效、已停用或已过期。', 409, 'INVITE_UNAVAILABLE');
  await assertNoCycle(tx, invite.ownerId, input.inviteeId);
  const consumed = await tx.inviteCode.updateMany({where: {id: invite.id, status: 'ACTIVE', version: invite.version, ...(invite.maxUses === null ? {} : {usedCount: {lt: invite.maxUses}})}, data: {usedCount: {increment: 1}, version: {increment: 1}}});
  if (consumed.count !== 1) throw new ReferralError('邀请码已达到使用上限或状态已变化。', 409, 'INVITE_UNAVAILABLE');
  const relationship = await tx.referralRelationship.create({data: {inviterId: invite.ownerId, inviteeId: input.inviteeId, inviteCodeId: invite.id}});
  await tx.user.update({where: {id: input.inviteeId}, data: {invitedByUserId: invite.ownerId}});
  return relationship;
}

export async function readMyReferrals(userId: string) {
  const code = await ensureActiveInviteCode(userId);
  const [parent, children] = await Promise.all([
    db.referralRelationship.findUnique({where: {inviteeId: userId}, select: {boundAt: true, inviter: {select: {id: true, username: true, displayName: true}}}}),
    db.referralRelationship.findMany({where: {inviterId: userId}, orderBy: {boundAt: 'desc'}, take: 100, select: {boundAt: true, invitee: {select: {id: true, username: true, displayName: true}}}}),
  ]);
  return {code, parent, children};
}

export async function listReferralRelationships(params: {q?: string; page?: number}) {
  const q = params.q?.trim() ?? '', page = params.page ?? 1;
  if (q.length > 100 || !Number.isSafeInteger(page) || page < 1) throw new ReferralError('查询条件无效。');
  const where: Prisma.ReferralRelationshipWhereInput = q ? {OR: [{inviter: {is: {OR: [{username: {contains: q}}, {email: {contains: q}}]}}}, {invitee: {is: {OR: [{username: {contains: q}}, {email: {contains: q}}]}}}]} : {};
  const [items, total] = await db.$transaction([db.referralRelationship.findMany({where, include: {inviter: {select: {id: true, username: true, email: true}}, invitee: {select: {id: true, username: true, email: true}}, inviteCode: {select: {code: true}}}, orderBy: {boundAt: 'desc'}, take: 50, skip: (page - 1) * 50}), db.referralRelationship.count({where})]);
  return {items, total, page, pageSize: 50};
}
