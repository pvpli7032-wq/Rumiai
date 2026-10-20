/**
 * History-invalidation transaction (m3-data-contract.md §7, plan chapter 16).
 *
 * Editing or deleting story message of turn N must, in the SAME transaction as
 * the message change: invalidate every derived event and checkpoint at or after
 * N, mark those turns' extraction state INVALIDATED, rebuild run.stateJson from
 * the most recent valid checkpoint (old summaries must never be injected into a
 * model again), and roll the run cursors back. One revision per transaction.
 *
 * The caller owns the transaction; this module only ever runs inside it.
 */
import type {Prisma} from '@prisma/client';
import {registerStoryHistoryInvalidator} from '@/lib/conversations/message-service';

type Client = Prisma.TransactionClient;

export async function invalidateStoryHistoryFrom(tx: Client, runId: string, fromTurnNo: number): Promise<void> {
  const run = await tx.storyRun.findUnique({
    where: {id: runId},
    select: {chapterKey: true, lastCommittedTurnNo: true, stateProcessedThroughTurnNo: true},
  });
  if (!run) return;
  const now = new Date();

  await tx.storyEvent.updateMany({
    where: {runId, status: {not: 'INVALIDATED'}, sourceTurn: {turnNo: {gte: fromTurnNo}}},
    data: {status: 'INVALIDATED', invalidatedAt: now},
  });
  await tx.storyCheckpoint.updateMany({
    where: {runId, throughTurnNo: {gte: fromTurnNo}, invalidatedAt: null},
    data: {invalidatedAt: now},
  });
  await tx.storyTurn.updateMany({
    where: {runId, turnNo: {gte: fromTurnNo}, stateStatus: {not: 'INVALIDATED'}},
    data: {stateStatus: 'INVALIDATED', leaseOwner: null, leaseExpiresAt: null},
  });

  // Rebuild from the newest surviving checkpoint; the initial checkpoint from run
  // creation always survives (fromTurnNo >= 1), so the fallback is defensive only.
  const checkpoint = await tx.storyCheckpoint.findFirst({
    where: {runId, invalidatedAt: null},
    orderBy: [{throughTurnNo: 'desc'}, {revision: 'desc'}],
    select: {stateJson: true},
  });
  const stateJson = checkpoint?.stateJson ?? JSON.stringify({schemaVersion: 1, chapterKey: run.chapterKey, facts: []});
  // Cursors only ever move backwards here: an earlier turn may still be unprocessed
  // (FAILED/PENDING), and claiming it processed would let close-chapter through.
  await tx.storyRun.updateMany({
    where: {id: runId},
    data: {
      stateJson,
      lastCommittedTurnNo: Math.min(run.lastCommittedTurnNo, fromTurnNo - 1),
      stateProcessedThroughTurnNo: Math.min(run.stateProcessedThroughTurnNo, fromTurnNo - 1),
      revision: {increment: 1},
    },
  });
}

/** The story turn a message belongs to, if the conversation is a story run. */
export async function findStoryTurnByMessage(tx: Client, runId: string, messageId: string) {
  return tx.storyTurn.findFirst({
    where: {runId, OR: [{inputMessageId: messageId}, {assistantMessageId: messageId}]},
    select: {turnNo: true},
  });
}

/**
 * Registers the story side of the message-edit/delete hook (dependency inversion:
 * conversations must not import stories). A message that belongs to no story turn
 * is left untouched; one that does triggers the §7 invalidation inside the caller's
 * transaction. The messages route imports this module so server processes always
 * register before serving edits.
 */
registerStoryHistoryInvalidator(async (tx, runId, messageId) => {
  const turn = await findStoryTurnByMessage(tx, runId, messageId);
  if (turn) await invalidateStoryHistoryFrom(tx, runId, turn.turnNo);
});
