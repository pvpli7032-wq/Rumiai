import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@/lib/db';
import {AdminOpsError, cursorParam, idParam, limitParam, statusParam} from './ops-error';

/**
 * 后台「他眼中的你」结果列表（只读 + 隐藏）。
 *
 * 只读运营视角：作者、角色、生成状态、创建时间、分享码、是否过期。
 * 隐藏是把状态置 HIDDEN，不删行：分享码立刻失效，但记录与费用单还能对上账。
 */

const STATUSES = ['READY', 'FAILED', 'HIDDEN', 'EXPIRED'] as const;
export type AdminMirrorStatus = typeof STATUSES[number];

export interface AdminMirrorResultItem {
  id: string;
  shareId: string;
  status: AdminMirrorStatus;
  title: string;
  quote: string;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
  anonymous: boolean;
  author: {id: string; name: string} | null;
  character: {id: string; name: string} | null;
}

export interface AdminMirrorResultPage {
  items: AdminMirrorResultItem[];
  nextCursor: string | null;
}

const rowSelect = {
  id: true,
  shareId: true,
  status: true,
  title: true,
  quote: true,
  createdAt: true,
  expiresAt: true,
  characterId: true,
  userId: true,
  anonymousSubject: true,
  user: {select: {id: true, username: true, displayName: true}},
} satisfies Prisma.MirrorResultSelect;

export async function listAdminMirrorResults(query: {status?: string | null; cursor?: string | null; limit?: string | null}): Promise<AdminMirrorResultPage> {
  await pragmasReady;
  const limit = limitParam(query.limit ?? null, 20, 50);
  const status = statusParam(query.status ?? null, STATUSES);
  const cursor = cursorParam(query.cursor ?? null);
  const where: Prisma.MirrorResultWhereInput = status ? {status} : {};
  const rows = await db.mirrorResult.findMany({
    where,
    orderBy: [{createdAt: 'desc'}, {id: 'desc'}],
    take: limit + 1,
    ...(cursor ? {cursor: {id: cursor}, skip: 1} : {}),
    select: rowSelect,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const characterIds = Array.from(new Set(page.map(row => row.characterId)));
  const characters = characterIds.length
    ? await db.character.findMany({where: {id: {in: characterIds}}, select: {id: true, name: true}})
    : [];
  const characterMap = new Map(characters.map(row => [row.id, row]));
  const now = Date.now();
  return {
    items: page.map(row => ({
      id: row.id,
      shareId: row.shareId,
      status: row.status as AdminMirrorStatus,
      title: row.title,
      quote: row.quote,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      expired: Boolean(row.expiresAt && row.expiresAt.getTime() <= now),
      anonymous: !row.userId,
      author: row.user ? {id: row.user.id, name: row.user.displayName ?? row.user.username} : null,
      character: characterMap.get(row.characterId) ? {id: row.characterId, name: characterMap.get(row.characterId)!.name} : null,
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  };
}

/**
 * 隐藏一条结果：分享码立即失效，行保留以便对账。已隐藏的重复操作直接返回现状。
 *
 * 后台不物理删行：删掉就没有 shareId 与费用单可以对账了，所以「隐藏」与表 19 说的
 * 「删除」在这张表上是同一个状态转换（READY/EXPIRED → HIDDEN），只保留这一个动作。
 */
export async function hideAdminMirrorResult(rawId: string): Promise<{id: string; shareId: string; status: AdminMirrorStatus; changed: boolean}> {
  await pragmasReady;
  const id = idParam(rawId);
  const row = await db.mirrorResult.findUnique({where: {id}, select: {id: true, shareId: true, status: true}});
  if (!row) throw new AdminOpsError('这条结果不存在，可能已被删除。', 404, 'NOT_FOUND');
  if (row.status === 'HIDDEN') return {id: row.id, shareId: row.shareId, status: 'HIDDEN', changed: false};
  await db.mirrorResult.update({where: {id}, data: {status: 'HIDDEN'}});
  return {id: row.id, shareId: row.shareId, status: 'HIDDEN', changed: true};
}

/**
 * 恢复一条被隐藏的结果（V3 表 19「恢复也在结果详情完成」）。
 *
 * 恢复到哪个状态不能一律写 READY：隐藏前那条结果可能已经过了保留期。
 * 表里没存「隐藏前的状态」，但那个状态本来就是 expires_at 的纯函数
 * （mirror-expire 任务也是这么判的），所以按过期时间还原：
 * 已过期 → EXPIRED，未过期 → READY。这样恢复不会把过期内容重新变成可访问。
 *
 * 写入用条件更新（只有仍处于 HIDDEN 的那一次生效），和隐藏保持同一套并发口径。
 */
export async function restoreAdminMirrorResult(rawId: string): Promise<{id: string; shareId: string; status: AdminMirrorStatus; changed: boolean}> {
  await pragmasReady;
  const id = idParam(rawId);
  const row = await db.mirrorResult.findUnique({where: {id}, select: {id: true, shareId: true, status: true, expiresAt: true}});
  if (!row) throw new AdminOpsError('这条结果不存在，可能已被删除。', 404, 'NOT_FOUND');
  if (row.status !== 'HIDDEN') return {id: row.id, shareId: row.shareId, status: row.status as AdminMirrorStatus, changed: false};
  const target: AdminMirrorStatus = row.expiresAt && row.expiresAt.getTime() <= Date.now() ? 'EXPIRED' : 'READY';
  const changed = await db.mirrorResult.updateMany({where: {id, status: 'HIDDEN'}, data: {status: target}});
  if (!changed.count) {
    const fresh = await db.mirrorResult.findUnique({where: {id}, select: {status: true}});
    if (!fresh) throw new AdminOpsError('这条结果不存在，可能已被删除。', 404, 'NOT_FOUND');
    return {id: row.id, shareId: row.shareId, status: fresh.status as AdminMirrorStatus, changed: false};
  }
  return {id: row.id, shareId: row.shareId, status: target, changed: true};
}
