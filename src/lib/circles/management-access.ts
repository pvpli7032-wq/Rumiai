import type {Prisma} from '@prisma/client';
import {db} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';
import {CircleError} from './errors';

type Permission = 'community.read' | 'community.write' | 'community.members.manage';
export async function requireCircleManagement(actor: string, permission: Permission = 'community.read', tx: Prisma.TransactionClient = db) {
  if (!await hasAdminPermission(actor, permission, tx) || permission !== 'community.read' && !await hasAdminPermission(actor, 'community.read', tx)) throw new CircleError('当前账号没有此社区管理权限。', 403);
}
export async function claimCircleManager(tx: Prisma.TransactionClient, actor: string, permission: Permission) {
  await tx.$executeRaw`UPDATE users SET account_version = account_version WHERE id = ${actor}`;
  await requireCircleManagement(actor, permission, tx);
}
export function readManagementCommand(input: unknown, needsVersion: boolean) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CircleError('圈子管理数据格式错误。');
  const body = input as Record<string, unknown>;
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500) throw new CircleError('请填写1–500字操作理由。');
  if (needsVersion && (typeof body.updatedAt !== 'string' || !Number.isFinite(Date.parse(body.updatedAt)))) throw new CircleError('缺少有效版本，请刷新后重试。');
  return {body, reason: body.reason.trim(), expected: needsVersion ? Date.parse(body.updatedAt as string) : null};
}
