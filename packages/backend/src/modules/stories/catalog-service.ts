import { db } from '@rumiai/backend/infrastructure/database/client';
import { encodeCursor } from '@rumiai/backend/infrastructure/http/pagination';
import { StoryError, readVersion } from '@rumiai/backend/modules/stories/repository/contracts';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const PUBLIC_KEYS = ['slug', 'title', 'locale', 'characterId', 'characterName', 'characterTagline', 'characterAvatarUrl', 'publicSummary', 'chapters', 'templateVersionId'] as const;

type Cursor = {updatedAt: string; id: string};

function parseCursor(value?: string | null): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof parsed.updatedAt !== 'string' || typeof parsed.id !== 'string' || !parsed.id) throw Error();
    return {updatedAt: parsed.updatedAt, id: parsed.id};
  } catch { throw new StoryError('INVALID_PAGINATION', '故事游标格式不正确。', 422); }
}

function limitOf(value?: number | string | null): number {
  if (value == null || value === '') return DEFAULT_LIMIT;
  const limit = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || (typeof value === 'string' && !/^\d+$/.test(value))) {
    throw new StoryError('INVALID_PAGINATION', '每页数量须为 1–50。', 422);
  }
  return Math.min(limit, MAX_LIMIT);
}

import type {PublicStory} from '@rumiai/contracts/stories/public';
export type {PublicStory} from '@rumiai/contracts/stories/public';

type TemplateRow = {slug: string; title: string};
type VersionRow = {id: string; locale: string; definitionJson: string; characterSnapshotJson: string};

async function toPublicStory(template: TemplateRow, version: VersionRow): Promise<PublicStory | null> {
  let definition;
  try { definition = readVersion(version.definitionJson, version.characterSnapshotJson); }
  catch (error) { if (error instanceof StoryError) return null; throw error; }
  const character = await db.character.findUnique({where: {id: definition.characterId}, select: {id: true, name: true, tagline: true, avatarUrl: true, isPublic: true, reviewStatus: true}});
  if (!character || !character.isPublic || character.reviewStatus !== 'APPROVED') return null;
  return {slug: template.slug, title: template.title, locale: version.locale, characterId: character.id, characterName: character.name, characterTagline: character.tagline, characterAvatarUrl: character.avatarUrl, publicSummary: definition.publicSummary, chapters: definition.chapters, templateVersionId: version.id};
}

export async function listPublishedStories(options: {locale?: string | null; cursor?: string | null; limit?: number | string | null} = {}) {
  const limit = limitOf(options.limit);
  const cursor = parseCursor(options.cursor);
  const now = new Date();
  const where = {status: 'PUBLISHED', versions: {some: {publishedAt: {not: null, lte: now}, ...(options.locale ? {locale: options.locale} : {}), characterSnapshotJson: {not: ''}}}, ...(cursor ? {OR: [{updatedAt: {lt: new Date(cursor.updatedAt)}}, {updatedAt: new Date(cursor.updatedAt), id: {lt: cursor.id}}]} : {})};
  const rows = await db.storyTemplate.findMany({
    where, orderBy: [{updatedAt: 'desc'}, {id: 'desc'}], take: limit + 1,
    include: {versions: {where: {publishedAt: {not: null, lte: now}, ...(options.locale ? {locale: options.locale} : {})}, orderBy: [{version: 'desc'}, {publishedAt: 'desc'}, {id: 'desc'}], take: 1}},
  });
  // Page over ROWS, not over surviving items: a row whose character is no longer public
  // drops out of the payload, and paging over the filtered list would end the cursor
  // early (or loop) whenever a whole page's worth of rows drops out.
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  const items: PublicStory[] = [];
  for (const row of visible) {
    const version = row.versions[0];
    if (!version) continue;
    const view = await toPublicStory(row, version);
    if (view) items.push(view);
  }
  const lastRow = hasMore ? visible[visible.length - 1] : null;
  return {items, nextCursor: lastRow ? encodeCursor({updatedAt: lastRow.updatedAt.toISOString(), id: lastRow.id}) : null};
}

export async function readPublishedStory(slug: string): Promise<PublicStory> {
  const row = await db.storyTemplate.findFirst({where: {slug, status: 'PUBLISHED'}, include: {versions: {where: {publishedAt: {not: null, lte: new Date()}}, orderBy: [{version: 'desc'}, {publishedAt: 'desc'}, {id: 'desc'}], take: 1}}});
  if (!row || !row.versions[0]) throw new StoryError('STORY_NOT_FOUND', '故事不存在或暂不可用。', 404);
  const view = await toPublicStory(row, row.versions[0]);
  if (!view) throw new StoryError('STORY_NOT_FOUND', '故事不存在或暂不可用。', 404);
  return view;
}

export const publicStoryKeys = PUBLIC_KEYS;
