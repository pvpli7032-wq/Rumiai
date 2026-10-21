import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@/lib/db';
import {closeDisputeCase, DISPUTE_CLOSE_TASK} from '@/lib/disputes/close-service';
import {markCaseHidden} from '@/lib/disputes/visibility-service';
import {recordAdminAudit} from './management-service';
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

/** 后台隐藏写进 admin_audit_logs 的动作名：不加字段，原因与操作人都从这条记录来。 */
const HIDE_ACTION = 'DISPUTE_CASE_HIDDEN';

export interface AdminDisputeHidden {
  reason: string;
  at: string;
  actor: {id: string; name: string} | null;
}

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
  /** 后台隐藏记录：原因与操作人。作者撤回不会产生这一项。 */
  hidden: AdminDisputeHidden | null;
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
  const [characters, failures, hides] = await Promise.all([
    characterIds.length ? db.character.findMany({where: {id: {in: characterIds}}, select: {id: true, name: true}}) : Promise.resolve([]),
    ids.length
      ? db.backgroundTask.findMany({where: {kind: DISPUTE_CLOSE_TASK, subjectId: {in: ids}, lastError: {not: null}}, select: {subjectId: true, lastError: true, updatedAt: true, attempts: true}})
      : Promise.resolve([]),
    ids.length
      ? db.adminAuditLog.findMany({where: {action: HIDE_ACTION, targetId: {in: ids}}, orderBy: [{createdAt: 'desc'}, {id: 'desc'}], select: {targetId: true, actorId: true, reason: true, createdAt: true}})
      : Promise.resolve([]),
  ]);
  const characterMap = new Map(characters.map(row => [row.id, row]));
  const failureMap = new Map(failures.map(row => [row.subjectId, row]));
  // 一个案例可能被隐藏多次（先撤回再隐藏也算），列表只展示最近一次。
  const hideMap = new Map<string, {actorId: string; reason: string; createdAt: Date}>();
  for (const hide of hides) if (!hideMap.has(hide.targetId)) hideMap.set(hide.targetId, hide);
  const actors = hideMap.size
    ? await db.user.findMany({where: {id: {in: [...new Set([...hideMap.values()].map(hide => hide.actorId))]}}, select: {id: true, username: true, displayName: true}})
    : [];
  const actorMap = new Map(actors.map(row => [row.id, row.displayName ?? row.username]));
  const now = Date.now();
  return {
    items: page.map(row => {
      const failure = failureMap.get(row.id);
      const character = row.characterId ? characterMap.get(row.characterId) : undefined;
      const hide = hideMap.get(row.id);
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
        hidden: hide ? {
          reason: hide.reason,
          at: hide.createdAt.toISOString(),
          actor: actorMap.has(hide.actorId) ? {id: hide.actorId, name: actorMap.get(hide.actorId)!} : null,
        } : null,
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
/** 隐藏原因：必须由运营自己写，1–300 字，原样进操作日志。 */
function hideReason(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 300) throw new AdminOpsError('请填写 1–300 字的隐藏原因。');
  return text;
}

/**
 * 后台隐藏案例（V3 §24「公开与撤回」：可由作者撤回或后台隐藏）。
 *
 * 案例置 WITHDRAWN 而不是保留 OPEN：结案入口在 closeStatus !== 'OPEN' 时直接 SKIPPED，
 * 所以被隐藏的案例不会再跑结案任务、也不会突然冒出一条角色回应；投票与公开访问同样停下。
 * 若只把帖子置 HIDDEN 而留着 OPEN，结案任务会把它当成「发起人撤回」立刻写一条兜底判词，
 * 运营会看到自己藏起来的案例自己结案——这正是要避免的。
 * 为什么与作者撤回共用同一个状态：状态列只有四个取值（不能改 schema），
 * 「作者撤回」与「后台隐藏」的区别由 admin_audit_logs 的这条记录承载（动作 + 原因 + 操作人）。
 */
export async function hideAdminDisputeCase(actorId: string, rawId: string, rawReason: unknown) {
  await pragmasReady;
  const id = idParam(rawId);
  const reason = hideReason(rawReason);
  return db.$transaction(async tx => {
    const row = await tx.disputeCase.findUnique({where: {id}, select: {id: true, postId: true, closeStatus: true}});
    if (!row) throw new AdminOpsError('这个评理案例不存在。', 404, 'NOT_FOUND');
    if (row.closeStatus === 'CLOSED') throw new AdminOpsError('这个案例已经结案，结案结果不能再隐藏。', 409, 'CONFLICT');
    if (row.closeStatus === 'CLOSING') throw new AdminOpsError('这个案例正在结案，等这次结案结束后再隐藏。', 409, 'CONFLICT');
    const alreadyHidden = row.closeStatus === 'WITHDRAWN';
    await markCaseHidden(tx, {caseId: id, postId: row.postId});
    // 即使案例已经是 WITHDRAWN，这次后台操作本身也要留痕，否则看不到是谁藏的和为什么。
    await recordAdminAudit(tx, actorId, HIDE_ACTION, id, reason, {
      postId: row.postId,
      before: {closeStatus: row.closeStatus},
      after: {closeStatus: 'WITHDRAWN', postStatus: 'HIDDEN'},
    });
    return {caseId: id, hidden: true, alreadyHidden};
  });
}
