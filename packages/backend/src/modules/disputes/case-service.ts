import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {recordProductEvent} from '@rumiai/backend/modules/analytics/product-events';
import {readConversationMessages} from '@rumiai/backend/modules/conversations/message-service';
import {readCommunityRestriction} from '@rumiai/backend/modules/community/restriction-service';
import type {DisputeCandidate, DisputeCaseRecord, DisputeCaseSummary, DisputeListResult, DisputeRuleSnapshot, DisputeSort} from '@rumiai/contracts/disputes/types';
import {emptyTally} from '@rumiai/contracts/disputes/types';
import {parseExcerpt, parseVerdict, voteState} from '@rumiai/backend/modules/disputes/case-parse';
import {buildRuleSnapshot, DISPUTE_TOPIC_ID, disputeDayStart, ensureDisputeTopic, HOUR_MS, readDisputeOptions, snapshotOf} from '@rumiai/backend/modules/disputes/case-rules';
import {caseSelect, readCaseCharacters, readPostFacts, readTallies, toSummary, type CaseRow} from '@rumiai/backend/modules/disputes/case-view';

/**
 * 评理广场：发起与读取（V3 第 24 章）。
 *
 * 案例复用系统圈子的帖子承载评论、点赞与举报，这里只新增案例本身：
 * 创建时把运营规则写进 rule_snapshot_json，此后后台改设置不影响已开案例。
 * 帖子在 schema 里没有反向关系，所以帖子状态统一用 postId 单独读。
 *
 * 规则、JSON 解析、展示映射分别在 case-rules / case-parse / case-view；
 * 这里只留发起、列表、详情与结案读取的编排。
 */

export {readDisputeOptions} from '@rumiai/backend/modules/disputes/case-rules';
export {snapshotOf} from '@rumiai/backend/modules/disputes/case-rules';
export {readTallies} from '@rumiai/backend/modules/disputes/case-view';

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
    await ensureDisputeTopic(tx);
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
