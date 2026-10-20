import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { StoryError, parseCreate, readVersion } from './contracts';

export const runInclude = {templateVersion: {include: {template: true}}, conversation: {include: {character: true}}} as const;
type Run = Prisma.StoryRunGetPayload<{include: typeof runInclude}>;
type Client = Pick<Prisma.TransactionClient, 'storyRun' | 'storyEvent' | 'storyTurn' | 'storyCheckpoint'>;

function visibleWhere(userId: string): Prisma.StoryRunWhereInput {
  return {
    userId,
    conversation: {userId, character: {OR: [{creatorId: userId}, {isPublic: true, reviewStatus: 'APPROVED'}]}},
  };
}

/**
 * Write-path gate (W07): a run stays readable after its template is taken
 * offline (history view/export, plan chapter 24), but no NEW turns may start
 * and a paused run may not resume. Chapter closing stays allowed — it is
 * bookkeeping on already-committed turns, not new content.
 */
export function requirePublishedTemplate(run: {templateVersion: {template: {status: string}}}) {
  if (run.templateVersion.template.status !== 'PUBLISHED') {
    throw new StoryError('STORY_OFFLINE', '故事内容已下架，不能继续新回合，历史记录仍可查看与导出。', 422);
  }
}

/** The run must belong to the user and its template/character must still be publicly usable. */
export async function requireVisibleRun(client: Client, userId: string, id: string) {
  const run = await client.storyRun.findFirst({where: {id, ...visibleWhere(userId)}, include: runInclude});
  if (!run) throw new StoryError('STORY_NOT_FOUND', '故事不存在或暂不可用。', 404);
  return run;
}

/** Public run view; lifecycle services reuse it inside their own transactions. */
export async function view(client: Client, run: Run) {
  const definition = readVersion(run.templateVersion.definitionJson, run.templateVersion.characterSnapshotJson);
  const chapter = definition.chapters.find(item => item.key === run.chapterKey);
  if (!chapter || definition.characterId !== run.conversation.characterId) throw new StoryError('INVALID_STORY_DATA', '故事版本数据不完整。', 422);
  const turns = await client.storyTurn.findMany({
    where: {runId: run.id}, orderBy: {turnNo: 'desc'}, take: 100,
    select: {id: true, turnNo: true, status: true, stateStatus: true, inputMessageId: true, assistantMessageId: true, errorCode: true, committedAt: true},
  });
  const rows = await client.storyEvent.findMany({
    where: {runId: run.id, status: 'CONFIRMED', invalidatedAt: null, sourceTurn: {runId: run.id, status: 'COMMITTED', stateStatus: 'PROCESSED'}, sourceMessage: {conversationId: run.conversationId}},
    orderBy: [{createdAt: 'desc'}, {id: 'desc'}], take: 100,
  });
  const events = rows.map(row => {
    // The public event envelope is distinct from extractor/private state JSON.
    let payload: {summary: string};
    try {
      const parsed = JSON.parse(row.payloadJson);
      if (parsed.schemaVersion !== 1 || typeof parsed.publicSummary !== 'string' || !parsed.publicSummary.trim() || parsed.publicSummary.length > 2000) throw Error();
      payload = {summary: parsed.publicSummary};
    } catch { throw new StoryError('INVALID_STORY_DATA', '故事事件数据不完整。', 422); }
    return {id: row.id, type: row.type, status: row.status, chapterKey: row.chapterKey, payload, sourceMessageId: row.sourceMessageId, createdAt: row.createdAt};
  });
  return {
    id: run.id, conversationId: run.conversationId,
    template: {id: run.templateVersion.templateId, version: run.templateVersion.version, locale: run.templateVersion.locale, title: run.templateVersion.template.title, publicSummary: definition.publicSummary},
    chapter, status: run.status, revision: run.revision, lastCommittedTurnNo: run.lastCommittedTurnNo,
    stateProcessedThroughTurnNo: run.stateProcessedThroughTurnNo, events: events.reverse(), turns: turns.reverse(),
    createdAt: run.createdAt, updatedAt: run.updatedAt,
  };
}

export async function readStoryRun(userId: string, id: string) {
  return db.$transaction(async tx => ({run: await view(tx, await requireVisibleRun(tx, userId, id))}));
}

export async function createStoryRun(userId: string, input: unknown) {
  const body = parseCreate(input);
  const replay = async (tx: Client, existing: {id: string; templateVersionId: string; chapterKey: string}) => {
    // chapterKey changes later; initial chapter is retained in the initial checkpoint.
    const initial = await tx.storyCheckpoint.findFirst({where: {runId: existing.id, throughTurnNo: 0, revision: 0}, select: {stateJson: true}});
    let initialChapter: unknown;
    try {
      if (!initial) throw Error();
      const state = JSON.parse(initial.stateJson);
      if (state.schemaVersion !== 1 || typeof state.chapterKey !== 'string') throw Error();
      initialChapter = state.chapterKey;
    } catch { throw new StoryError('INVALID_STORY_DATA', '故事初始状态不完整。', 422); }
    if (existing.templateVersionId !== body.templateVersionId || initialChapter !== body.chapterKey) throw new StoryError('REQUEST_CONFLICT', '请求标识已用于另一个故事请求。', 409);
    return {run: await view(tx, await requireVisibleRun(tx, userId, existing.id)), created: false};
  };
  try {
    return await db.$transaction(async tx => {
      const existing = await tx.storyRun.findUnique({where: {userId_createRequestId: {userId, createRequestId: body.requestId}}});
      if (existing) return replay(tx, existing);
      const version = await tx.storyTemplateVersion.findFirst({where: {id: body.templateVersionId, publishedAt: {lte: new Date()}, template: {status: 'PUBLISHED'}}, include: {template: true}});
      if (!version) throw new StoryError('STORY_NOT_FOUND', '故事版本不存在或暂不可用。', 404);
      const definition = readVersion(version.definitionJson, version.characterSnapshotJson);
      if (!definition.chapters.some(item => item.key === body.chapterKey)) throw new StoryError('INVALID_CHAPTER', '故事章节不存在。', 422);
      const character = await tx.character.findFirst({where: {id: definition.characterId, OR: [{creatorId: userId}, {isPublic: true, reviewStatus: 'APPROVED'}]}});
      if (!character) throw new StoryError('STORY_NOT_FOUND', '故事角色不存在或暂不可用。', 404);
      const conversation = await tx.conversation.create({data: {userId, characterId: character.id, title: version.template.title, relationshipStatus: character.relationshipStatus, romance: character.initialRomance, intimacy: character.initialIntimacy}});
      const stateJson = JSON.stringify({schemaVersion: 1, chapterKey: body.chapterKey});
      const run = await tx.storyRun.create({data: {userId, conversationId: conversation.id, templateVersionId: version.id, chapterKey: body.chapterKey, createRequestId: body.requestId, stateJson, startedAt: new Date(), checkpoints: {create: {throughTurnNo: 0, revision: 0, stateJson}}}, include: runInclude});
      await tx.character.update({where: {id: character.id}, data: {chatCount: {increment: 1}}});
      return {run: await view(tx, run), created: true};
    });
  } catch (error) {
    // Only a known unique-key collision is replayed; unknown write results are not retried.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await db.storyRun.findUnique({where: {userId_createRequestId: {userId, createRequestId: body.requestId}}});
      if (existing) return db.$transaction(tx => replay(tx, existing));
    }
    throw error;
  }
}

export async function listStoryRuns(userId: string, options: {limit?: string | null; cursor?: string | null} = {}) {
  const limit = options.limit == null ? 20 : Number(options.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (options.limit != null && !/^\d+$/.test(options.limit))) throw new StoryError('INVALID_PAGINATION', '每页数量须为 1–100。', 422);
  return db.$transaction(async tx => {
    const cursor = options.cursor ? await requireVisibleRun(tx, userId, options.cursor) : null;
    const rows = await tx.storyRun.findMany({
      where: {...visibleWhere(userId), ...(cursor ? {OR: [{updatedAt: {lt: cursor.updatedAt}}, {updatedAt: cursor.updatedAt, id: {lt: cursor.id}}]} : {})},
      orderBy: [{updatedAt: 'desc'}, {id: 'desc'}], take: limit + 1,
      select: {id: true, conversationId: true, chapterKey: true, status: true, revision: true, updatedAt: true, templateVersion: {select: {template: {select: {title: true}}}}},
    });
    const items = rows.slice(0, limit).map(({templateVersion, ...run}) => ({...run, templateTitle: templateVersion.template.title}));
    return {items, nextCursor: rows.length > limit ? items[items.length - 1].id : null};
  });
}
