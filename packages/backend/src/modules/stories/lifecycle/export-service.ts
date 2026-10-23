/**
 * Story data export (W07; plan chapters 11/24, acceptance A13).
 *
 * Two entries share one whitelist projection:
 * - exportStoryRun: per-run structured JSON via GET /api/story-runs/[id]/export.
 * - exportAccountStories: the story section merged into the account archive
 *   (users/me/export) inside the caller's transaction.
 *
 * The whitelist NEVER contains: hidden plot fields, character prompts or
 * snapshots, extractor/private state JSON, leases, request hashes, or any
 * other user's data. Event payloads are projected through the same public
 * envelope rule as the run view; a row whose envelope fails validation is
 * skipped rather than exported unsafely. Message content only ever comes from
 * the user's own conversation.
 */
import {db} from '@rumiai/backend/infrastructure/database/client';
import {StoryError, readVersion} from '@rumiai/backend/modules/stories/repository/contracts';
import {requireVisibleRun} from '@rumiai/backend/modules/stories/repository/run-service';

/** Public projection of one event row; mirrors run-service.view() envelope rule. */
function projectEvent(row: {id: string; type: string; status: string; chapterKey: string; payloadJson: string; sourceMessageId: string | null; invalidatedAt: Date | null; createdAt: Date}) {
  try {
    const parsed = JSON.parse(row.payloadJson);
    if (parsed.schemaVersion !== 1 || typeof parsed.publicSummary !== 'string' || !parsed.publicSummary.trim() || parsed.publicSummary.length > 2000) return null;
    return {id: row.id, type: row.type, status: row.status, chapterKey: row.chapterKey, summary: parsed.publicSummary, sourceMessageId: row.sourceMessageId, invalidatedAt: row.invalidatedAt, createdAt: row.createdAt};
  } catch { return null; }
}

/** Per-run export. Works for offline templates: history export must survive下架. */
export async function exportStoryRun(userId: string, runId: string) {
  return db.$transaction(async tx => {
    const run = await requireVisibleRun(tx, userId, runId);
    const definition = readVersion(run.templateVersion.definitionJson, run.templateVersion.characterSnapshotJson);
    const chapter = definition.chapters.find(item => item.key === run.chapterKey);
    if (!chapter) throw new StoryError('INVALID_STORY_DATA', '故事版本数据不完整。', 422);
    const [turnMessages, turns, eventRows, shares] = await Promise.all([
      // Only the story turns' own messages: the account archive already carries the
      // whole conversation, and exporting the full thread here would exceed the story
      // boundary (both entries now use one rule).
      tx.message.findMany({
        where: {conversationId: run.conversationId, NOT: {storyInputTurns: {none: {}}, storyAssistantTurns: {none: {}}}},
        orderBy: [{createdAt: 'asc'}, {id: 'asc'}],
        select: {id: true, role: true, content: true, imageUrl: true, createdAt: true},
      }),
      tx.storyTurn.findMany({
        where: {runId: run.id}, orderBy: {turnNo: 'asc'},
        select: {turnNo: true, status: true, stateStatus: true, errorCode: true, committedAt: true},
      }),
      // Invalidated rows carry no summary by construction; the filter is a second guard.
      tx.storyEvent.findMany({
        where: {runId: run.id, status: {not: 'INVALIDATED'}},
        orderBy: [{createdAt: 'asc'}, {id: 'asc'}],
        select: {id: true, type: true, status: true, chapterKey: true, payloadJson: true, sourceMessageId: true, invalidatedAt: true, createdAt: true},
      }),
      // Shares are part of the run's public footprint; withdrawn ones are labelled, not
      // hidden. Selected fragments are the user's own story turns, so the export keeps
      // their content; internal ids stay out (only a count is exported).
      tx.storyShare.findMany({
        where: {runId: run.id, userId}, orderBy: {createdAt: 'asc'},
        select: {id: true, title: true, status: true, withdrawnAt: true, createdAt: true, snapshotJson: true, storyTurnSelection: {select: {message: {select: {id: true, role: true, content: true, createdAt: true}}}}},
      }),
    ]);
    const events = eventRows.map(projectEvent).filter(Boolean);
    const shareRows = shares.map(({snapshotJson, storyTurnSelection, ...share}) => {
      let snapshot: unknown = null;
      try { snapshot = JSON.parse(snapshotJson); } catch { snapshot = null; }
      return {...share, snapshot, messageCount: storyTurnSelection.length};
    });
    return {
      exportedAt: new Date().toISOString(),
      run: {
        id: run.id, conversationId: run.conversationId,
        template: {id: run.templateVersion.templateId, version: run.templateVersion.version, locale: run.templateVersion.locale, title: run.templateVersion.template.title, publicSummary: definition.publicSummary},
        chapter, status: run.status, revision: run.revision,
        lastCommittedTurnNo: run.lastCommittedTurnNo, stateProcessedThroughTurnNo: run.stateProcessedThroughTurnNo,
        startedAt: run.startedAt, endedAt: run.endedAt, createdAt: run.createdAt, updatedAt: run.updatedAt,
      },
      messages: turnMessages, turns, events, shares: shareRows,
    };
  });
}

/** Account-archive section: bookkeeping and public event envelopes, no message bodies (already in conversations). */
export async function exportAccountStories(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], userId: string) {
  const runs = await tx.storyRun.findMany({
    where: {userId}, orderBy: [{createdAt: 'asc'}, {id: 'asc'}],
    select: {
      id: true, conversationId: true, chapterKey: true, status: true, revision: true,
      lastCommittedTurnNo: true, stateProcessedThroughTurnNo: true, startedAt: true, endedAt: true, createdAt: true, updatedAt: true,
      templateVersion: {select: {version: true, locale: true, template: {select: {title: true}}}},
    },
  });
  if (!runs.length) return [];
  const [turnRows, eventRows] = await Promise.all([
    tx.storyTurn.findMany({
      where: {run: {userId}}, orderBy: {turnNo: 'asc'},
      select: {runId: true, turnNo: true, status: true, stateStatus: true, errorCode: true, committedAt: true},
    }),
    tx.storyEvent.findMany({
      where: {run: {userId}},
      orderBy: [{createdAt: 'asc'}, {id: 'asc'}],
      select: {runId: true, id: true, type: true, status: true, chapterKey: true, payloadJson: true, sourceMessageId: true, invalidatedAt: true, createdAt: true},
    }),
  ]);
  const turnsByRun = new Map<string, Array<{turnNo: number; status: string; stateStatus: string; errorCode: string | null; committedAt: Date | null}>>();
  for (const row of turnRows) {
    const list = turnsByRun.get(row.runId) ?? [];
    list.push({turnNo: row.turnNo, status: row.status, stateStatus: row.stateStatus, errorCode: row.errorCode, committedAt: row.committedAt});
    turnsByRun.set(row.runId, list);
  }
  const eventsByRun = new Map<string, Array<NonNullable<ReturnType<typeof projectEvent>>>>();
  for (const row of eventRows) {
    const projected = projectEvent(row);
    if (!projected) continue;
    const list = eventsByRun.get(row.runId) ?? [];
    list.push(projected);
    eventsByRun.set(row.runId, list);
  }
  return runs.map(({templateVersion, ...run}) => ({
    ...run,
    template: {version: templateVersion.version, locale: templateVersion.locale, title: templateVersion.template.title},
    turns: turnsByRun.get(run.id) ?? [],
    events: eventsByRun.get(run.id) ?? [],
  }));
}
