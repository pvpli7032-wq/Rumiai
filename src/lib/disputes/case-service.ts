import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@/lib/db';
import {readSettingValue} from '@/lib/settings';
import {recordProductEvent} from '@/lib/analytics/product-events';
import {readConversationMessages} from '@/lib/conversations/message-service';
import {readCommunityRestriction} from '@/lib/community/restriction-service';
import type {DisputeCandidate, DisputeCaseRecord, DisputeCaseSummary, DisputeExcerptMessage, DisputeExcerptOptions, DisputeListResult, DisputeRuleSnapshot, DisputeSort, DisputeVerdict, DisputeVoteState} from './types';
import {emptyTally, isDisputeRules, leadingChoice} from './types';

/**
 * 评理广场：发起与读取（V3 第 24 章）。
 *
 * 案例复用系统圈子的帖子承载评论、点赞与举报，这里只新增案例本身：
 * 创建时把运营规则写进 rule_snapshot_json，此后后台改设置不影响已开案例。
 * 帖子在 schema 里没有反向关系，所以帖子状态统一用 postId 单独读。
 */

/** 案例挂在系统圈子里：它给评论、点赞、举报一个落点，但不在圈子列表里做推荐。 */
export const DISPUTE_TOPIC_ID = 'xingban-topic-disputes';
const DISPUTE_TOPIC_NAME = '评理广场';
const DISPUTE_TOPIC_DESCRIPTION = '谁更有理：从聊天摘出片段，写明诉求，让大家投票。评论、点赞与举报沿用社区规则。';
const DISPUTE_TOPIC_TAGS = '评理,社区';

/** 业务日按 Asia/Shanghai 切：每日发起限制不会随 UTC 零点漂移。 */
const DISPUTE_DAY_OFFSET_MS = 8 * 3_600_000;
const HOUR_MS = 3_600_000;

export class DisputeError extends Error {
  readonly reason: string;
  readonly status: number;
  readonly retryAfter?: number;
  constructor(message: string, status = 400, reason = 'INVALID', retryAfter?: number) {
    super(message);
    this.name = 'DisputeError';
    this.status = status;
    this.reason = reason;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

export function disputeErrorResponse(error: unknown) {
  if (error instanceof DisputeError) {
    return {status: error.status, headers: error.retryAfter ? {'Retry-After': String(error.retryAfter)} : undefined, message: error.message};
  }
  return null;
}

export function disputeDayStart(now = new Date()) {
  const shifted = new Date(now.getTime() + DISPUTE_DAY_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - DISPUTE_DAY_OFFSET_MS);
}

/**
 * 读运营规则。必须在真正执行动作时读：设置值不允许导出成模块顶层常量，
 * 否则后台改完不生效。
 */
export async function readDisputeOptions(userId?: string | null): Promise<DisputeExcerptOptions> {
  const [enabled, maxExcerptMessages, claimMaxChars, dailyLimit, minAccountAgeHours, maxVoteChanges, closeAfterHours, closeAtVotes, verdictMaxChars] = await Promise.all([
    readSettingValue<boolean>('dispute.enabled'),
    readSettingValue<number>('dispute.maxExcerptMessages'),
    readSettingValue<number>('dispute.claimMaxChars'),
    readSettingValue<number>('dispute.dailyLimit'),
    readSettingValue<number>('dispute.minAccountAgeHours'),
    readSettingValue<number>('dispute.maxVoteChanges'),
    readSettingValue<number>('dispute.closeAfterHours'),
    readSettingValue<number>('dispute.closeAtVotes'),
    readSettingValue<number>('dispute.verdictMaxChars'),
  ]);
  const base = {maxExcerptMessages: Number(maxExcerptMessages), claimMaxChars: Number(claimMaxChars), dailyLimit: Number(dailyLimit), minAccountAgeHours: Number(minAccountAgeHours), maxVoteChanges: Number(maxVoteChanges), closeAfterHours: Number(closeAfterHours), closeAtVotes: Number(closeAtVotes), verdictMaxChars: Number(verdictMaxChars)};
  if (!userId) return {...base, enabled: Boolean(enabled), remaining: null, eligible: null, topicName: DISPUTE_TOPIC_NAME};
  const [user, used] = await Promise.all([
    db.user.findUnique({where: {id: userId}, select: {createdAt: true, deletedAt: true, suspendedAt: true}}),
    db.disputeCase.count({where: {authorId: userId, createdAt: {gte: disputeDayStart()}}}),
  ]);
  const ageHours = user ? (Date.now() - user.createdAt.getTime()) / HOUR_MS : 0;
  const valid = Boolean(user && !user.deletedAt && !user.suspendedAt);
  return {...base, enabled: Boolean(enabled), remaining: valid ? Math.max(0, base.dailyLimit - used) : 0, eligible: valid && ageHours >= base.minAccountAgeHours, topicName: DISPUTE_TOPIC_NAME};
}

/** 把当前设置冻结成快照。创建时只写一次，之后的投票与结案都读快照。 */
export function buildRuleSnapshot(options: DisputeExcerptOptions, now = new Date()): DisputeRuleSnapshot {
  return {
    version: 1,
    capturedAt: now.toISOString(),
    closeAfterHours: options.closeAfterHours,
    closeAtVotes: options.closeAtVotes,
    maxVoteChanges: options.maxVoteChanges,
    verdictMaxChars: options.verdictMaxChars,
    maxExcerptMessages: options.maxExcerptMessages,
    claimMaxChars: options.claimMaxChars,
  };
}

export function snapshotOf(raw: string): DisputeRuleSnapshot {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isDisputeRules(parsed) ? parsed : fallbackRules();
  } catch {
    return fallbackRules();
  }
}

/** 历史脏数据兜底：按 V3 默认值，不抛错让详情整页打不开。 */
function fallbackRules(): DisputeRuleSnapshot {
  return {version: 1, capturedAt: '', closeAfterHours: 48, closeAtVotes: 200, maxVoteChanges: 1, verdictMaxChars: 120, maxExcerptMessages: 6, claimMaxChars: 60};
}

export function parseExcerpt(raw: string | null | undefined): DisputeExcerptMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      if (typeof row.messageId !== 'string' || typeof row.content !== 'string') return [];
      return [{messageId: row.messageId, role: row.role === 'USER' ? 'USER' as const : 'ASSISTANT' as const, content: row.content, createdAt: String(row.createdAt ?? '')}];
    });
  } catch {
    return [];
  }
}

export function parseVerdict(raw: string | null): DisputeVerdict | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DisputeVerdict;
    return typeof parsed.text === 'string' && (parsed.status === 'READY' || parsed.status === 'FALLBACK') ? parsed : null;
  } catch {
    return null;
  }
}

async function ensureTopic(tx: Prisma.TransactionClient) {
  const existing = await tx.circle.findUnique({where: {id: DISPUTE_TOPIC_ID}, select: {id: true}});
  if (existing) return;
  await tx.circle.create({data: {id: DISPUTE_TOPIC_ID, name: DISPUTE_TOPIC_NAME, description: DISPUTE_TOPIC_DESCRIPTION, tags: DISPUTE_TOPIC_TAGS, ownerId: null, status: 'ACTIVE'}});
}

/** 发起页的候选消息：只读当前用户自己的会话，最近 60 条作为可选窗口。 */
export async function readExcerptCandidates(userId: string, conversationId: string): Promise<{characterId: string; characterName: string; messages: DisputeCandidate[]}> {
  await pragmasReady;
  const conversation = await db.conversation.findFirst({where: {id: conversationId, userId}, select: {characterId: true, character: {select: {name: true}}}});
  if (!conversation) throw new DisputeError('聊天不存在或不属于你。', 404, 'NOT_FOUND');
  const messages = await readConversationMessages(userId, conversationId);
  return {
    characterId: conversation.characterId,
    characterName: conversation.character.name,
    messages: messages.slice(-60).flatMap(message => (message.role === 'USER' || message.role === 'ASSISTANT')
      ? [{messageId: message.id, role: message.role, content: message.content, createdAt: message.createdAt.toISOString()} satisfies DisputeCandidate]
      : []),
  };
}

/**
 * 摘录必须是同一会话里的连续消息；服务端按 messageIds 重新取内容，
 * 前端传什么都不影响快照，跨会话或伪造的消息直接拒绝。
 */
export async function readSelectedExcerpt(userId: string, conversationId: string, messageIds: string[], maxCount: number) {
  if (!Array.isArray(messageIds) || messageIds.length === 0) throw new DisputeError('请至少选择 1 条消息作为摘录。');
  if (messageIds.length > maxCount) throw new DisputeError(`最多选择 ${maxCount} 条连续消息作为摘录。`);
  if (new Set(messageIds).size !== messageIds.length) throw new DisputeError('摘录消息不能重复。');
  const {characterId, characterName, messages} = await readExcerptCandidates(userId, conversationId);
  const index = new Map(messages.map((message, position) => [message.messageId, position]));
  const positions = messageIds.map(id => index.get(id));
  if (positions.some(position => position === undefined)) throw new DisputeError('所选消息不属于这段聊天，请重新选择。');
  const sorted = [...positions as number[]].sort((a, b) => a - b);
  if (sorted[sorted.length - 1] - sorted[0] !== sorted.length - 1) throw new DisputeError('摘录必须是聊天里的连续消息。');
  const excerpt = sorted.map(position => messages[position]);
  if (excerpt.some(message => !message.content.trim())) throw new DisputeError('摘录里包含空消息，请重新选择。');
  return {characterId, characterName, excerpt};
}

export async function createDisputeCase(userId: string, input: unknown): Promise<{caseId: string; postId: string; snapshot: DisputeRuleSnapshot}> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DisputeError('发起数据格式不正确。');
  const body = input as {conversationId?: unknown; messageIds?: unknown; claim?: unknown};
  const options = await readDisputeOptions(userId);
  if (!options.enabled) throw new DisputeError('评理广场暂停发起新案例，已有案例照常结束。', 403, 'FORBIDDEN');
  if (!options.eligible) throw new DisputeError(`注册满 ${options.minAccountAgeHours} 小时后才能发起评理。`, 403, 'FORBIDDEN');
  if ((options.remaining ?? 0) <= 0) throw new DisputeError(`每天最多发起 ${options.dailyLimit} 个案例，请明天再来。`, 429, 'LIMITED');
  if (typeof body.conversationId !== 'string' || !body.conversationId) throw new DisputeError('请选择一段自己的聊天。');
  const claim = typeof body.claim === 'string' ? body.claim.trim() : '';
  if (!claim) throw new DisputeError('请填写你的诉求。');
  if (claim.length > options.claimMaxChars) throw new DisputeError(`诉求最多 ${options.claimMaxChars} 字。`);
  if (!Array.isArray(body.messageIds)) throw new DisputeError('摘录消息格式不正确。');
  const {characterId, excerpt} = await readSelectedExcerpt(userId, body.conversationId, body.messageIds as string[], options.maxExcerptMessages);

  const now = new Date();
  const rules = buildRuleSnapshot(options, now);
  const deadlineAt = new Date(now.getTime() + rules.closeAfterHours * HOUR_MS);
  await pragmasReady;

  const created = await db.$transaction(async tx => {
    const restriction = await readCommunityRestriction(userId, tx);
    if (restriction?.communityBannedAt) throw new DisputeError('你的社区发言权限暂时受限。', 403, 'FORBIDDEN');
    // 事务内再数一次：并发发起时以事务里的计数为准。
    const used = await tx.disputeCase.count({where: {authorId: userId, createdAt: {gte: disputeDayStart(now)}}});
    if (used >= options.dailyLimit) throw new DisputeError(`每天最多发起 ${options.dailyLimit} 个案例，请明天再来。`, 429, 'LIMITED');
    await ensureTopic(tx);
    const post = await tx.post.create({data: {circleId: DISPUTE_TOPIC_ID, authorId: userId, characterId, content: claim}, select: {id: true}});
    const row = await tx.disputeCase.create({
      data: {postId: post.id, authorId: userId, characterId, excerptJson: JSON.stringify(excerpt), claim, ruleSnapshotJson: JSON.stringify(rules), deadlineAt},
      select: {id: true},
    });
    return {caseId: row.id, postId: post.id, snapshot: rules};
  });
  // 漏斗埋点写在事务之外：统计写失败不影响已经创建的案例。
  await recordProductEvent({event: 'dispute_started', userId, subjectKey: created.caseId});
  return created;
}

/** 投票统计：dispute_votes 的唯一键保证一人一票，这里只负责逐票累计。 */
export function tallyVotes(rows: Array<{choice: string}>) {
  const tally = emptyTally();
  for (const row of rows) {
    if (row.choice === 'AUTHOR' || row.choice === 'OTHER' || row.choice === 'SPLIT') tally[row.choice] += 1;
  }
  tally.total = tally.AUTHOR + tally.OTHER + tally.SPLIT;
  return tally;
}

export async function readTallies(caseIds: string[]) {
  if (!caseIds.length) return new Map<string, ReturnType<typeof emptyTally>>();
  const rows = await db.disputeVote.findMany({where: {caseId: {in: caseIds}}, select: {caseId: true, choice: true}});
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.caseId) ?? [];
    bucket.push(row.choice);
    grouped.set(row.caseId, bucket);
  }
  return new Map(caseIds.map(id => [id, tallyVotes((grouped.get(id) ?? []).map(choice => ({choice})))]));
}

/** 列表与详情只需要的案例字段；帖子字段另取，避免依赖 schema 里不存在的反向关系。 */
export const caseSelect = {
  id: true, postId: true, authorId: true, characterId: true, claim: true, createdAt: true, deadlineAt: true, closeStatus: true, voteCount: true, ruleSnapshotJson: true, excerptJson: true,
  author: {select: {id: true, username: true, displayName: true, avatarUrl: true}},
} as const;

export type CaseRow = {
  id: string; postId: string; authorId: string; characterId: string | null; claim: string; createdAt: Date; deadlineAt: Date; closeStatus: string; voteCount: number; ruleSnapshotJson: string; excerptJson: string;
  author: {id: string; username: string; displayName: string | null; avatarUrl: string | null};
};

/** 角色不在 DisputeCase 的关系里（schema 只存 characterId），按 id 批量补名字。 */
export async function readCaseCharacters(characterIds: Array<string | null>) {
  const ids = [...new Set(characterIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map<string, {id: string; name: string}>();
  const rows = await db.character.findMany({where: {id: {in: ids}}, select: {id: true, name: true}});
  return new Map(rows.map(row => [row.id, row]));
}

/** 一次取齐页内所有帖子的公开状态与可见评论数。 */
export async function readPostFacts(postIds: string[]) {
  if (!postIds.length) return new Map<string, {status: string; commentCount: number}>();
  const rows = await db.post.findMany({where: {id: {in: postIds}}, select: {id: true, status: true, _count: {select: {comments: {where: {status: 'VISIBLE'}}}}}});
  return new Map(rows.map(row => [row.id, {status: row.status, commentCount: row._count.comments}]));
}

function voteState(vote: {choice: string; reviseCount: number} | null | undefined, maxVoteChanges: number): DisputeVoteState | null {
  if (!vote || (vote.choice !== 'AUTHOR' && vote.choice !== 'OTHER' && vote.choice !== 'SPLIT')) return null;
  return {choice: vote.choice, reviseCount: vote.reviseCount, maxVoteChanges, remainingChanges: Math.max(0, maxVoteChanges - vote.reviseCount)};
}

export function toSummary(row: CaseRow, facts: {commentCount: number} | undefined, tally: ReturnType<typeof emptyTally>, myVote: DisputeVoteState | null, character: {id: string; name: string} | null = null): DisputeCaseSummary {
  const rules = snapshotOf(row.ruleSnapshotJson);
  const excerpt = parseExcerpt(row.excerptJson);
  return {
    id: row.id, postId: row.postId, claim: row.claim,
    createdAt: row.createdAt.toISOString(), deadlineAt: row.deadlineAt.toISOString(),
    closeStatus: row.closeStatus === 'CLOSED' || row.closeStatus === 'CLOSING' ? row.closeStatus : 'OPEN',
    voteCount: tally.total,
    closeAtVotes: rules.closeAtVotes, closeAfterHours: rules.closeAfterHours,
    tally, main: leadingChoice(tally),
    author: {id: row.author.id, name: row.author.displayName ?? row.author.username, avatarUrl: row.author.avatarUrl},
    character,
    commentCount: facts?.commentCount ?? 0,
    excerptCount: excerpt.length,
    excerpt,
    myVote,
    ...(row.closeStatus === 'WITHDRAWN' ? {withdrawn: true} : {}),
  };
}

export async function listDisputeCases(query: {sort?: DisputeSort; cursor?: string | null; limit?: number; userId?: string | null}): Promise<DisputeListResult> {
  await pragmasReady;
  const limit = Math.min(30, Math.max(1, query.limit ?? 20));
  const sort: DisputeSort = query.sort === 'latest' || query.sort === 'joined' ? query.sort : 'hot';
  const viewer = query.userId ?? null;
  if (sort === 'joined' && !viewer) throw new DisputeError('登录后才能查看我参与的评理。', 401, 'UNAUTHORIZED');
  // 「我参与的」包含自己发起的与投过票的；撤回的案例只对发起人自己留在列表里。
  const where: Prisma.DisputeCaseWhereInput = sort === 'joined'
    ? {OR: [{authorId: viewer!}, {votes: {some: {userId: viewer!}}}]}
    : {OR: [{closeStatus: {not: 'WITHDRAWN'}}, ...(viewer ? [{authorId: viewer}] : [])]};
  const orderBy = sort === 'hot'
    ? [{voteCount: 'desc' as const}, {createdAt: 'desc' as const}, {id: 'desc' as const}]
    : [{createdAt: 'desc' as const}, {id: 'desc' as const}];
  const rows: CaseRow[] = await db.disputeCase.findMany({where, orderBy, take: limit + 1, ...(query.cursor ? {cursor: {id: query.cursor}, skip: 1} : {}), select: caseSelect});
  const ids = rows.map(row => row.id);
  const [facts, tallyMap, mine, characters] = await Promise.all([
    readPostFacts(rows.map(row => row.postId)),
    readTallies(ids),
    viewer && ids.length ? db.disputeVote.findMany({where: {caseId: {in: ids}, userId: viewer}, select: {caseId: true, choice: true, reviseCount: true}}) : Promise.resolve([]),
    readCaseCharacters(rows.map(row => row.characterId)),
  ]);
  const myVoteMap = new Map(mine.map(vote => [vote.caseId, vote]));
  // 帖子被社区隐藏或删除后不出现在公开列表；发起人自己在「我参与的」里还看得到状态。
  const visible = rows.filter(row => facts.get(row.postId)?.status === 'VISIBLE' || row.authorId === viewer || myVoteMap.has(row.id));
  const hasMore = visible.length > limit;
  const page = hasMore ? visible.slice(0, limit) : visible;
  return {
    items: page.map(row => {
      const maxVoteChanges = snapshotOf(row.ruleSnapshotJson).maxVoteChanges;
      const character = row.characterId ? characters.get(row.characterId) ?? null : null;
      return toSummary(row, facts.get(row.postId), tallyMap.get(row.id) ?? emptyTally(), voteState(myVoteMap.get(row.id), maxVoteChanges), character);
    }),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  };
}

export async function readDisputeCase(caseId: string, userId?: string | null): Promise<DisputeCaseSummary & {authorId: string}> {
  await pragmasReady;
  const row: CaseRow | null = await db.disputeCase.findUnique({where: {id: caseId}, select: caseSelect});
  if (!row) throw new DisputeError('评理案例不存在或已撤回。', 404, 'NOT_FOUND');
  const facts = await readPostFacts([row.postId]);
  const isAuthor = Boolean(userId && userId === row.authorId);
  const factsForPost = facts.get(row.postId);
  if (row.closeStatus === 'WITHDRAWN' && !isAuthor) throw new DisputeError('评理案例不存在或已撤回。', 404, 'NOT_FOUND');
  if (factsForPost?.status !== 'VISIBLE' && !isAuthor) throw new DisputeError('评理案例不存在或已撤回。', 404, 'NOT_FOUND');
  const [tallyMap, mine, characters] = await Promise.all([
    readTallies([row.id]),
    userId ? db.disputeVote.findUnique({where: {caseId_userId: {caseId: row.id, userId}}, select: {choice: true, reviseCount: true}}) : Promise.resolve(null),
    readCaseCharacters([row.characterId]),
  ]);
  const maxVoteChanges = snapshotOf(row.ruleSnapshotJson).maxVoteChanges;
  const character = row.characterId ? characters.get(row.characterId) ?? null : null;
  return {...toSummary(row, factsForPost, tallyMap.get(row.id) ?? emptyTally(), voteState(mine, maxVoteChanges), character), authorId: row.authorId};
}

/** 结案任务/后台读取的轻量记录；postStatus 用来判断帖子是否已被社区隐藏。 */
export async function readCaseRecord(caseId: string): Promise<DisputeCaseRecord & {postStatus: string}> {
  const row = await db.disputeCase.findUnique({
    where: {id: caseId},
    select: {id: true, postId: true, authorId: true, characterId: true, claim: true, excerptJson: true, ruleSnapshotJson: true, deadlineAt: true, voteCount: true, closeStatus: true, verdictJson: true, closedAt: true, createdAt: true},
  });
  if (!row) throw new DisputeError('评理案例不存在。', 404, 'NOT_FOUND');
  const post = await db.post.findUnique({where: {id: row.postId}, select: {status: true}});
  return {
    id: row.id, postId: row.postId, authorId: row.authorId, characterId: row.characterId, claim: row.claim,
    excerpt: parseExcerpt(row.excerptJson), rules: snapshotOf(row.ruleSnapshotJson),
    deadlineAt: row.deadlineAt.toISOString(), voteCount: row.voteCount,
    closeStatus: row.closeStatus as DisputeCaseRecord['closeStatus'],
    verdict: parseVerdict(row.verdictJson),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    postStatus: post?.status ?? 'DELETED',
  };
}
