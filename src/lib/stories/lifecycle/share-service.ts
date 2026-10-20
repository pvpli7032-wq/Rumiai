/**
 * Story share records (W07; plan chapter 11, acceptance A09/A13).
 *
 * A share is a user-selected snapshot of 2–6 of their own story messages.
 * Data layer only — the reader-facing entry stays with the existing posts
 * service (chapter 11); no front-door is opened here.
 *
 * Withdraw semantics: withdrawing flips this record to WITHDRAWN and never
 * touches the run itself (no revision bump, no state change). Readers inherit
 * nothing: a share carries only the selected message ids — no state, events,
 * relationship values or private notes.
 */
import {db} from '@/lib/db';
import {StoryError, object, text} from '../repository/contracts';
import {requireVisibleRun} from '../repository/run-service';

const MIN_SELECTED = 2;
const MAX_SELECTED = 6;

function parseShareBody(input: unknown) {
  const body = object(input);
  const title = text(body.title, 200);
  if (!Array.isArray(body.messageIds)) throw new StoryError('INVALID_SHARE_REQUEST', '请选择要分享的消息。', 422);
  const messageIds = body.messageIds.map(id => text(id, 100));
  const unique = new Set(messageIds);
  if (messageIds.length !== unique.size) throw new StoryError('INVALID_SHARE_REQUEST', '分享的消息不能重复。', 422);
  if (messageIds.length < MIN_SELECTED || messageIds.length > MAX_SELECTED) {
    throw new StoryError('INVALID_SHARE_REQUEST', `分享片段须选择 ${MIN_SELECTED}–${MAX_SELECTED} 条消息。`, 422);
  }
  return {title, messageIds};
}

function shareView(share: {id: string; runId: string; title: string; status: string; selectedMessageIdsJson: string; publishedPostId: string | null; withdrawnAt: Date | null; createdAt: Date}) {
  return {id: share.id, runId: share.runId, title: share.title, status: share.status,
    selectedMessageIds: JSON.parse(share.selectedMessageIdsJson) as string[],
    publishedPostId: share.publishedPostId, withdrawnAt: share.withdrawnAt, createdAt: share.createdAt};
}

export async function createStoryShare(userId: string, runId: string, input: unknown) {
  const body = parseShareBody(input);
  return db.$transaction(async tx => {
    const run = await requireVisibleRun(tx, userId, runId);
    // Only messages committed by this run's own turns are shareable; uncommitted
    // or foreign-conversation ids are rejected without exposing which ones exist.
    const committedTurns = await tx.storyTurn.findMany({
      where: {runId: run.id, status: 'COMMITTED', OR: [{inputMessageId: {in: body.messageIds}}, {assistantMessageId: {in: body.messageIds}}]},
      select: {inputMessageId: true, assistantMessageId: true},
    });
    const committedIds = new Set(committedTurns.flatMap(turn => [turn.inputMessageId, turn.assistantMessageId]).filter((id): id is string => typeof id === 'string'));
    if (body.messageIds.some(id => !committedIds.has(id))) {
      throw new StoryError('MESSAGE_NOT_IN_RUN', '所选消息不属于这个故事，无法分享。', 422);
    }
    const share = await tx.storyShare.create({data: {
      runId: run.id, userId, title: body.title,
      selectedMessageIdsJson: JSON.stringify(body.messageIds), status: 'PUBLISHED',
    }});
    return {share: shareView(share)};
  });
}

export async function withdrawStoryShare(userId: string, runId: string, shareId: string) {
  return db.$transaction(async tx => {
    const share = await tx.storyShare.findFirst({where: {id: shareId, runId, userId}});
    if (!share) throw new StoryError('SHARE_NOT_FOUND', '分享记录不存在。', 404);
    if (share.status === 'WITHDRAWN') throw new StoryError('SHARE_ALREADY_WITHDRAWN', '该分享已撤回。', 409);
    // Only the share row changes; the run body is untouched by design.
    const now = new Date();
    const withdrawn = await tx.storyShare.updateMany({
      where: {id: share.id, status: 'PUBLISHED'},
      data: {status: 'WITHDRAWN', withdrawnAt: now},
    });
    if (!withdrawn.count) throw new StoryError('SHARE_ALREADY_WITHDRAWN', '该分享已撤回。', 409);
    return {share: shareView({...share, status: 'WITHDRAWN', withdrawnAt: now})};
  });
}
