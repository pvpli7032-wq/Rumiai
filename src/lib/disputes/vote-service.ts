import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@/lib/db';
import {recordProductEvent} from '@/lib/analytics/product-events';
import {DisputeError, snapshotOf} from './case-service';
import {awardVoteReward} from './reward-service';
import {isDisputeChoice, type DisputeChoice} from './types';

/**
 * 评理投票（V3 第 24 章）。
 *
 * 一人一票由 dispute_votes 的唯一键 (case_id, user_id) 保证；改票只有这一条写入路径。
 * 可改票次数取案例创建时的规则快照，与同一案例的结案阈值保持同一口径，
 * 后台改设置只影响之后新开的案例。
 * 计数在同一个事务里更新；票数到阈值不在这里结案，由调用方登记持久任务。
 */

export type VoteOutcome =
  | {kind: 'VOTED'; choice: DisputeChoice; reviseCount: number; voteCount: number}
  | {kind: 'UNCHANGED'; choice: DisputeChoice; reviseCount: number; voteCount: number};

function bodyOf(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DisputeError('投票数据格式不正确。');
  const choice = (input as Record<string, unknown>).choice;
  if (!isDisputeChoice(choice)) throw new DisputeError('请选择「我更有理」「TA 更有理」或「各打五十大板」。');
  return choice;
}

/** 事务内主流程：投票 + 票数 + 规则快照阈值判断，一次拿到，避免调用方再查一遍。 */
export async function applyVote(tx: Prisma.TransactionClient, caseId: string, userId: string, input: unknown): Promise<VoteOutcome & {closeAtVotes: number}> {
  const choice = bodyOf(input);
  const row = await tx.disputeCase.findUnique({where: {id: caseId}, select: {authorId: true, closeStatus: true, deadlineAt: true, ruleSnapshotJson: true, postId: true}});
  const post = row ? await tx.post.findUnique({where: {id: row.postId}, select: {status: true}}) : null;
  if (!row || post?.status !== 'VISIBLE' || row.closeStatus === 'WITHDRAWN') throw new DisputeError('评理案例不存在或已撤回。', 404, 'NOT_FOUND');
  if (row.authorId === userId) throw new DisputeError('不能给自己发起的案例投票。', 403, 'FORBIDDEN');
  if (row.closeStatus === 'CLOSED') throw new DisputeError('这个案例已经结案，不能再投票。', 409, 'CONFLICT');
  if (row.closeStatus !== 'OPEN') throw new DisputeError('这个案例正在结案，暂时不能投票。', 409, 'CONFLICT');
  if (row.deadlineAt.getTime() <= Date.now()) throw new DisputeError('这个案例已到截止时间，正在结案。', 409, 'CONFLICT');

  const rules = snapshotOf(row.ruleSnapshotJson);
  const existing = await tx.disputeVote.findUnique({where: {caseId_userId: {caseId, userId}}, select: {id: true, choice: true, reviseCount: true}});
  if (!existing) {
    await tx.disputeVote.create({data: {caseId, userId, choice, reviseCount: 0}});
    const updated = await tx.disputeCase.update({where: {id: caseId}, data: {voteCount: {increment: 1}}, select: {voteCount: true}});
    return {kind: 'VOTED', choice, reviseCount: 0, voteCount: updated.voteCount, closeAtVotes: rules.closeAtVotes};
  }
  if (existing.choice === choice) {
    const current = await tx.disputeCase.findUniqueOrThrow({where: {id: caseId}, select: {voteCount: true}});
    return {kind: 'UNCHANGED', choice, reviseCount: existing.reviseCount, voteCount: current.voteCount, closeAtVotes: rules.closeAtVotes};
  }
  if (existing.reviseCount >= rules.maxVoteChanges) {
    throw new DisputeError(rules.maxVoteChanges > 0 ? `每个案例最多改票 ${rules.maxVoteChanges} 次。` : '这个案例不支持改票。', 409, 'CONFLICT');
  }
  // 条件更新兜住并发改票：只有把 revise_count 推出旧值的那一次生效，改票次数不会被多算。
  const changed = await tx.disputeVote.updateMany({where: {id: existing.id, reviseCount: existing.reviseCount}, data: {choice, reviseCount: {increment: 1}}});
  if (!changed.count) throw new DisputeError('你的投票刚被修改过，请刷新后重试。', 409, 'CONFLICT');
  const current = await tx.disputeCase.findUniqueOrThrow({where: {id: caseId}, select: {voteCount: true}});
  return {kind: 'VOTED', choice, reviseCount: existing.reviseCount + 1, voteCount: current.voteCount, closeAtVotes: rules.closeAtVotes};
}

export async function voteDispute(caseId: string, userId: string, input: unknown) {
  await pragmasReady;
  let outcome: VoteOutcome & {closeAtVotes: number};
  try {
    outcome = await db.$transaction(tx => applyVote(tx, caseId, userId, input));
  } catch (error) {
    // SQLite 串行化冲突：让客户端重试，不静默吞掉。
    if (typeof error === 'object' && error && 'code' in error && (error as {code?: string}).code === 'P2034') {
      throw new DisputeError('投票正在被处理，请重试。', 409, 'CONFLICT', 1);
    }
    throw error;
  }
  if (outcome.kind === 'VOTED') {
    // 漏斗埋点与参与奖都在投票事务之外：两者都不会回滚用户已经提交的投票。
    await recordProductEvent({event: 'dispute_voted', userId, subjectKey: caseId});
    await awardVoteReward(caseId, userId);
  }
  return outcome;
}
