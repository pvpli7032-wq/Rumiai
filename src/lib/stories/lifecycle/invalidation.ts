/**
 * History-invalidation transaction（V3 第 16 章）。
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

/** What an invalidated event keeps instead of its summary: no content survives. */
export const INVALIDATED_EVENT_PAYLOAD = JSON.stringify({schemaVersion: 1, invalidated: true});

/** What an auto-withdrawn share keeps instead of its snapshot: no content survives. */
export const WITHDRAWN_SHARE_SNAPSHOT = JSON.stringify({schemaVersion: 1, withdrawn: true});

export async function invalidateStoryHistoryFrom(tx: Client, runId: string, fromTurnNo: number): Promise<void> {
  const run = await tx.storyRun.findUnique({
    where: {id: runId},
    select: {chapterKey: true, lastCommittedTurnNo: true, stateProcessedThroughTurnNo: true},
  });
  if (!run) return;
  const now = new Date();

  // The summary is derived from a message the user has since edited or deleted, so the
  // payload itself is cleared here, not merely flagged: export/retry/share must never be
  // able to bring an invalidated summary back into view (privacy rule, m1-story-privacy.md §3).
  await tx.storyEvent.updateMany({
    where: {runId, status: {not: 'INVALIDATED'}, sourceTurn: {turnNo: {gte: fromTurnNo}}},
    data: {status: 'INVALIDATED', invalidatedAt: now, payloadJson: INVALIDATED_EVENT_PAYLOAD},
  });
  await tx.storyCheckpoint.updateMany({
    where: {runId, throughTurnNo: {gte: fromTurnNo}, invalidatedAt: null},
    data: {invalidatedAt: now},
  });
  await tx.storyTurn.updateMany({
    where: {runId, turnNo: {gte: fromTurnNo}, stateStatus: {not: 'INVALIDATED'}},
    data: {stateStatus: 'INVALIDATED', leaseOwner: null, leaseExpiresAt: null},
  });

  // A share is a frozen snapshot, but a snapshot that quotes a message the user has
  // since edited or deleted must stop being published: withdraw it and drop its text
  // in the same transaction, so no export or reader can still show the old wording.
  const invalidatedTurns = await tx.storyTurn.findMany({
    where: {runId, turnNo: {gte: fromTurnNo}},
    select: {inputMessageId: true, assistantMessageId: true},
  });
  const affectedMessageIds = invalidatedTurns
    .flatMap(turn => [turn.inputMessageId, turn.assistantMessageId])
    .filter((id): id is string => typeof id === 'string');
  if (affectedMessageIds.length) {
    await tx.storyShare.updateMany({
      where: {runId, status: 'PUBLISHED', storyTurnSelection: {some: {messageId: {in: affectedMessageIds}}}},
      data: {status: 'WITHDRAWN', withdrawnAt: now, snapshotJson: WITHDRAWN_SHARE_SNAPSHOT},
    });
  }

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
 * transaction. src/instrumentation.ts imports this module as the composition root,
 * so registration does not depend on which route happens to load first.
 */
registerStoryHistoryInvalidator(async (tx, runId, messageId) => {
  const turn = await findStoryTurnByMessage(tx, runId, messageId);
  if (turn) await invalidateStoryHistoryFrom(tx, runId, turn.turnNo);
});
