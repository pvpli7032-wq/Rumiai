import {db} from '@/lib/db';
import type {DisputeCaseSummary, DisputeVoteState} from './types';
import {emptyTally, leadingChoice} from './types';
import {parseExcerpt} from './case-parse';
import {snapshotOf} from './case-rules';

/**
 * 案例的展示层数据：投票累计、角色名、帖子状态，以及行 → 摘要的映射。
 *
 * 列表与详情共用同一套读取与映射，两处各自写一份的话，字段迟早对不上。
 */

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
