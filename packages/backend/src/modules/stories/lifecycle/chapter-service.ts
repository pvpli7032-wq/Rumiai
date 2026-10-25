import {readStoredStorySceneSettings} from '@rumiai/contracts/stories/settings';
/**
 * Chapter lifecycle: retry-state, close-chapter, resume（V3 第 16 章）。
 *
 * All three are revision-CAS transactions: they compare expectedRevision, do one
 * state change, and increment the revision exactly once. A mismatch is a 409 that
 * carries the current public run view so the client can refresh — the server never
 * accepts a client-declared chapter completion.
 */
import {db} from '@rumiai/backend/infrastructure/database/client';
import {StoryError, parseRevision, readVersion} from '@rumiai/backend/modules/stories/repository/contracts';
import {readStoryRun, requireVisibleRun, requirePublishedTemplate, view} from '@rumiai/backend/modules/stories/repository/run-service';
import {chapterResultPayload} from '@rumiai/backend/modules/stories/lifecycle/state-model';

/** Attaches the current public run view to a revision conflict (contract §5). */
async function conflictWithRun(userId: string, runId: string, currentRevision: number): Promise<StoryError> {
  const {run} = await readStoryRun(userId, runId);
  return new StoryError('REVISION_CONFLICT', '故事状态已更新，请刷新后重试。', 409, {currentRevision, run});
}

/** True when every message the turn still references is present in its conversation. */
async function messagesStillExist(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], turn: {inputMessageId: string | null; assistantMessageId: string | null}) {
  const ids = [turn.inputMessageId, turn.assistantMessageId].filter((id): id is string => typeof id === 'string');
  if (!ids.length) return true;
  return (await tx.message.count({where: {id: {in: ids}}})) === ids.length;
}

/**
 * Re-queues the state extraction of a committed turn. Only the extraction is
 * redone — the committed messages are never re-sent to the model (B8).
 */
export async function retryStoryState(userId: string, runId: string, turnId: string, input: unknown) {
  const {expectedRevision} = parseRevision(input);
  return await db.$transaction(async tx => {
      await requireVisibleRun(tx, userId, runId);
      const turn = await tx.storyTurn.findFirst({where: {id: turnId, runId}, select: {id: true, status: true, stateStatus: true, inputMessageId: true, assistantMessageId: true}});
      if (!turn) throw new StoryError('STORY_NOT_FOUND', '回合不存在。', 404);
      if (turn.status !== 'COMMITTED') throw new StoryError('TURN_NOT_COMMITTED', '只有已提交的回合才能重试状态整理。', 422);
      // A turn whose messages the user edited or deleted must not be re-extracted:
      // that would turn a cleared summary back into a confirmed event (§7).
      if ((turn.inputMessageId || turn.assistantMessageId) && !(await messagesStillExist(tx, turn))) {
        throw new StoryError('STATE_NOT_RETRYABLE', '该回合的对话已被修改或删除，无法重新整理状态。', 422);
      }
      if (turn.stateStatus === 'PROCESSING') throw new StoryError('STATE_IN_PROGRESS', '状态整理正在进行中，请稍后再试。', 409);
      if (turn.stateStatus !== 'FAILED' && turn.stateStatus !== 'PENDING') {
        throw new StoryError('STATE_NOT_RETRYABLE', '该回合的状态无需重试。', 422);
      }
      const claimed = await tx.storyRun.updateMany({
        where: {id: runId, userId, revision: expectedRevision},
        data: {revision: {increment: 1}},
      });
      if (!claimed.count) {
        const current = await tx.storyRun.findUniqueOrThrow({where: {id: runId}, select: {revision: true}});
        throw await conflictWithRun(userId, runId, current.revision);
      }
      await tx.storyTurn.update({
        where: {id: turn.id},
        data: {stateStatus: 'PENDING', stateAttempts: 0, errorCode: null, leaseOwner: null, leaseExpiresAt: null},
      });
      return {turnId: turn.id, stateStatus: 'PENDING' as const, revision: expectedRevision + 1};
    });
}

/**
 * Closes the current chapter. Gate (contract §5: 条件不成立 422): the run must be
 * ACTIVE with at least one committed turn, and the state must be processed
 * exactly through the last committed turn with no unfinished extraction left.
 */
export async function closeChapter(userId: string, runId: string, input: unknown) {
  const {expectedRevision} = parseRevision(input);
  return db.$transaction(async tx => {
    const run = await requireVisibleRun(tx, userId, runId);
    if (run.status !== 'ACTIVE') throw new StoryError('RUN_NOT_ACTIVE', '故事当前不在进行中，无法结束章节。', 409);
    if (run.lastCommittedTurnNo < 1) throw new StoryError('CHAPTER_NOT_READY', '本章还没有已提交的回合，无法结束章节。', 422);
    const unfinished = await tx.storyTurn.count({where: {runId, stateStatus: {in: ['PENDING', 'PROCESSING', 'FAILED']}}});
    if (run.stateProcessedThroughTurnNo !== run.lastCommittedTurnNo || unfinished > 0) {
      throw new StoryError('STATE_NOT_READY', '还有回合的状态尚未整理完成，暂时无法结束章节。', 422);
    }
    const claimed = await tx.storyRun.updateMany({
      where: {id: runId, userId, revision: expectedRevision, status: 'ACTIVE'},
      data: {revision: {increment: 1}, status: 'PAUSED'},
    });
    if (!claimed.count) {
      const current = await tx.storyRun.findUniqueOrThrow({where: {id: runId}, select: {revision: true}});
      throw await conflictWithRun(userId, runId, current.revision);
    }
    // CHAPTER_RESULT is a server-side fact with a public, deterministic summary.
    const definition = readVersion(run.templateVersion.definitionJson, run.templateVersion.characterSnapshotJson);
    const chapter = definition.chapters.find(item => item.key === run.chapterKey);
    const sourceTurn = await tx.storyTurn.findFirst({where: {runId, turnNo: run.lastCommittedTurnNo}, select: {id: true}});
    if (chapter && sourceTurn) {
      await tx.storyEvent.create({data: {
        runId,
        sourceTurnId: sourceTurn.id,
        chapterKey: run.chapterKey,
        type: 'CHAPTER_RESULT',
        status: 'CONFIRMED',
        payloadJson: chapterResultPayload(`${chapter.title} 已在第 ${run.lastCommittedTurnNo} 回合完结。`),
      }});
    }
    return {run: await view(tx, await requireVisibleRun(tx, userId, runId))};
  });
}

/**
 * Re-opens a paused (chapter-closed) story. If the template defines a next
 * chapter, the run advances into it and the state records the transition.
 */
export async function resumeStory(userId: string, runId: string, input: unknown) {
  const {expectedRevision} = parseRevision(input);
  return db.$transaction(async tx => {
    const run = await requireVisibleRun(tx, userId, runId);
    if (run.status !== 'PAUSED') throw new StoryError('RUN_NOT_PAUSED', '故事当前不在章节结束状态，无法恢复。', 409);
    // Resuming opens NEW chapters, so an offline template blocks it; history stays viewable (W07).
    requirePublishedTemplate(run);
    const claimed = await tx.storyRun.updateMany({
      where: {id: runId, userId, revision: expectedRevision, status: 'PAUSED'},
      data: {revision: {increment: 1}, status: 'ACTIVE'},
    });
    if (!claimed.count) {
      const current = await tx.storyRun.findUniqueOrThrow({where: {id: runId}, select: {revision: true}});
      throw await conflictWithRun(userId, runId, current.revision);
    }
    const definition = readVersion(run.templateVersion.definitionJson, run.templateVersion.characterSnapshotJson);
    const index = definition.chapters.findIndex(item => item.key === run.chapterKey);
    const next = index >= 0 ? definition.chapters[index + 1] : undefined;
    const revision = expectedRevision + 1;
    if (next && next.key !== run.chapterKey) {
      // Record the chapter transition so a later invalidation rebuild keeps it.
      const state = JSON.parse(run.stateJson) as {schemaVersion?: unknown; chapterKey?: unknown; facts?: unknown};
      if (state.schemaVersion === 1 && typeof state.chapterKey === 'string') {
        const stateJson = JSON.stringify({...state, chapterKey: next.key});
        await tx.storyCheckpoint.create({data: {runId, throughTurnNo: run.lastCommittedTurnNo, revision, stateJson}});
        await tx.storyRun.update({where: {id: runId}, data: {chapterKey: next.key, stateJson,settingsJson:JSON.stringify({...readStoredStorySceneSettings(run.settingsJson),chapterGoal:''})}});
      }
    }
    return {run: await view(tx, await requireVisibleRun(tx, userId, runId))};
  });
}
