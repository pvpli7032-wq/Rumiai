/**
 * Story share records (W07; plan chapter 11, acceptance A09/A13).
 *
 * A share is a user-selected snapshot of 2–6 of their own story messages, frozen
 * into snapshotJson at creation so later edits/deletions cannot change what a
 * reader sees. Data layer only — the reader-facing entry stays with the existing
 * posts service (chapter 11); no front-door is opened here.
 *
 * Withdraw semantics: withdrawing flips this record to WITHDRAWN and never
 * touches the run itself (no revision bump, no state change). A reader gets the
 * frozen snapshot only — no state, events, relationship values or private notes.
 */
import {db} from '@/lib/db';
import {StoryError, object, readVersion, text} from '../repository/contracts';
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

function shareView(share: {id: string; runId: string; title: string; status: string; snapshotJson: string; publishedPostId: string | null; withdrawnAt: Date | null; createdAt: Date}) {
  return {id: share.id, runId: share.runId, title: share.title, status: share.status,
    snapshot: JSON.parse(share.snapshotJson) as ShareSnapshot,
    publishedPostId: share.publishedPostId, withdrawnAt: share.withdrawnAt, createdAt: share.createdAt};
}

/**
 * The only thing a reader ever sees: public template/chapter titles plus the
 * fragments the owner picked, frozen at creation. It carries no run state, no
 * events, no relationship values, no hidden plot and no internal story ids.
 */
export interface ShareSnapshot {
  schemaVersion: 1;
  templateTitle: string;
  chapterTitle: string;
  publicSummary: string;
  fragments: Array<{role: string; content: string}>;
}

export async function createStoryShare(userId: string, runId: string, input: unknown) {
  const body = parseShareBody(input);
  return db.$transaction(async tx => {
    const run = await requireVisibleRun(tx, userId, runId);
    // Only messages committed by this run's own turns — and still present in the run's
    // own conversation — are shareable; anything else is rejected without revealing
    // which ids exist (a pre-story greeting is not a story fragment).
    const committedTurns = await tx.storyTurn.findMany({
      where: {runId: run.id, status: 'COMMITTED', OR: [{inputMessageId: {in: body.messageIds}}, {assistantMessageId: {in: body.messageIds}}]},
      select: {inputMessageId: true, assistantMessageId: true},
    });
    const committedIds = new Set(committedTurns.flatMap(turn => [turn.inputMessageId, turn.assistantMessageId]).filter((id): id is string => typeof id === 'string'));
    if (body.messageIds.some(id => !committedIds.has(id))) {
      throw new StoryError('MESSAGE_NOT_IN_RUN', '所选消息不属于这个故事，无法分享。', 422);
    }
    const messages = await tx.message.findMany({
      where: {id: {in: body.messageIds}, conversationId: run.conversationId},
      select: {id: true, role: true, content: true},
    });
    if (messages.length !== body.messageIds.length) {
      throw new StoryError('MESSAGE_NOT_IN_RUN', '所选消息不属于这个故事，无法分享。', 422);
    }
    const byId = new Map(messages.map(message => [message.id, message]));
    const ordered = body.messageIds.map(id => byId.get(id)!);
    const definition = readVersion(run.templateVersion.definitionJson, run.templateVersion.characterSnapshotJson);
    const chapter = definition.chapters.find(item => item.key === run.chapterKey);
    if (!chapter) throw new StoryError('INVALID_STORY_DATA', '故事版本数据不完整。', 422);
    const snapshot: ShareSnapshot = {
      schemaVersion: 1,
      templateTitle: run.templateVersion.template.title,
      chapterTitle: chapter.title,
      publicSummary: definition.publicSummary,
      fragments: ordered.map(({role, content}) => ({role, content})),
    };
    const share = await tx.storyShare.create({data: {
      runId: run.id, userId, title: body.title,
      selectedMessageIdsJson: JSON.stringify(body.messageIds), snapshotJson: JSON.stringify(snapshot), status: 'PUBLISHED',
      storyTurnSelection: {create: ordered.map((message, position) => ({messageId: message.id, position}))},
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
