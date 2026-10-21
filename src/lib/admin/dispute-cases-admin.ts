import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@/lib/db';
import {closeDisputeCase, DISPUTE_CLOSE_TASK} from '@/lib/disputes/close-service';
import {AdminOpsError, cursorParam, idParam, limitParam, statusParam} from './ops-error';

/**
 * 后台评理案例列表与「立即结案」。
 *
 * 列表给运营看状态、票数、截止时间与最近一次失败原因；失败原因来自 background_tasks.last_error，
 * 不是猜的。结案复用评理域的同一条结案路径（force=true 跳过截止时间与票数门槛），
 * 后台不另写一套计票与判词逻辑。
 */

const STATUSES = ['OPEN', 'CLOSING', 'CLOSED', 'WITHDRAWN'] as const;
export type AdminDisputeStatus = typeof STATUSES[number];

export interface AdminDisputeCaseItem {
  id: string;
  postId: string;
  claim: string;
  status: AdminDisputeStatus;
  voteCount: number;
  deadlineAt: string;
  createdAt: string;
  closedAt: string | null;
  overdue: boolean;
  author: {id: string; name: string} | null;
  character: {id: string; name: string} | null;
  lastFailure: {message: string; at: string; attempts: number} | null;
}

export interface AdminDisputeCasePage {
  items: AdminDisputeCaseItem[];
  nextCursor: string | null;
}

const rowSelect = {
  id: true,
  postId: true,
  claim: true,
  closeStatus: true,
  voteCount: true,
  deadlineAt: true,
  createdAt: true,
  closedAt: true,
  characterId: true,
  author: {select: {id: true, username: true, displayName: true}},
} satisfies Prisma.DisputeCaseSelect;

export async function listAdminDisputeCases(query: {status?: string | null; cursor?: string | null; limit?: string | null}): Promise<AdminDisputeCasePage> {
  await pragmasReady;
  const limit = limitParam(query.limit ?? null, 20, 50);
  const status = statusParam(query.status ?? null, STATUSES);
  const cursor = cursorParam(query.cursor ?? null);
  const where: Prisma.DisputeCaseWhereInput = status ? {closeStatus: status} : {};
  // 待结案按截止时间从近到远（最该处理的在最前），其他按创建时间倒序。
  const orderBy: Prisma.DisputeCaseOrderByWithRelationInput[] = status === 'OPEN'
    ? [{deadlineAt: 'asc'}, {id: 'asc'}]
    : [{createdAt: 'desc'}, {id: 'desc'}];
  const rows = await db.disputeCase.findMany({
    where,
    orderBy,
    take: limit + 1,
    ...(cursor ? {cursor: {id: cursor}, skip: 1} : {}),
    select: rowSelect,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const ids = page.map(row => row.id);
  const characterIds = [...new Set(page.map(row => row.characterId).filter((id): id is string => Boolean(id)))];
  const [characters, failures] = await Promise.all([
    characterIds.length ? db.character.findMany({where: {id: {in: characterIds}}, select: {id: true, name: true}}) : Promise.resolve([]),
    ids.length
      ? db.backgroundTask.findMany({where: {kind: DISPUTE_CLOSE_TASK, subjectId: {in: ids}, lastError: {not: null}}, select: {subjectId: true, lastError: true, updatedAt: true, attempts: true}})
      : Promise.resolve([]),
  ]);
  const characterMap = new Map(characters.map(row => [row.id, row]));
  const failureMap = new Map(failures.map(row => [row.subjectId, row]));
  const now = Date.now();
  return {
    items: page.map(row => {
      const failure = failureMap.get(row.id);
      const character = row.characterId ? characterMap.get(row.characterId) : undefined;
      return {
        id: row.id,
        postId: row.postId,
        claim: row.claim,
        status: row.closeStatus as AdminDisputeStatus,
        voteCount: row.voteCount,
        deadlineAt: row.deadlineAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        closedAt: row.closedAt ? row.closedAt.toISOString() : null,
        overdue: row.closeStatus === 'OPEN' && row.deadlineAt.getTime() <= now,
        author: row.author ? {id: row.author.id, name: row.author.displayName ?? row.author.username} : null,
        character: character ? {id: character.id, name: character.name} : null,
        lastFailure: failure && failure.lastError ? {message: failure.lastError, at: failure.updatedAt.toISOString(), attempts: failure.attempts} : null,
      };
    }),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  };
}

/** 后台立即结案：不等截止时间也不等票数，仍走一次模型回应，失败时写明确的非 AI 兜底。 */
export async function closeAdminDisputeCase(rawId: string) {
  await pragmasReady;
  const id = idParam(rawId);
  const row = await db.disputeCase.findUnique({where: {id}, select: {id: true, closeStatus: true}});
  if (!row) throw new AdminOpsError('这个评理案例不存在。', 404, 'NOT_FOUND');
  if (row.closeStatus === 'WITHDRAWN') throw new AdminOpsError('发起人已撤回这个案例，不再结案。', 409, 'CONFLICT');
  if (row.closeStatus === 'CLOSED') throw new AdminOpsError('这个案例已经结案了，请刷新查看结果。', 409, 'CONFLICT');
  const result = await closeDisputeCase(id, {force: true});
  if (result.status === 'SKIPPED') throw new AdminOpsError('这个案例当前不能结案，请刷新后重试。', 409, 'CONFLICT');
  return {
    caseId: result.caseId,
    status: result.status,
    source: result.source ?? null,
    alreadyClosed: result.status === 'ALREADY_CLOSED',
  };
}
