import {createHash} from 'node:crypto';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {PrismaClient} from '@prisma/client';
import {readVersion} from '../src/lib/stories/repository/contracts.ts';

const root = process.cwd();
const contentDir = path.resolve(process.env.STORY_CONTENT_DIR || path.join(root, 'content', 'stories'));
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\//, '').replaceAll('/', path.sep));
function fail(message) { throw new Error(message); }
function normalized(value) {
  if (Array.isArray(value)) return '[' + value.map(normalized).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + normalized(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function hash(value) { return createHash('sha256').update(normalized(value)).digest('hex'); }
function readFiles() {
  if (!existsSync(contentDir)) fail('故事模板内容目录不存在：' + contentDir);
  const files = readdirSync(contentDir).filter(name => name.endsWith('.json')).sort();
  if (!files.length) fail('故事模板内容目录为空：' + contentDir);
  return files.map(name => { try { return {name, value: JSON.parse(readFileSync(path.join(contentDir, name), 'utf8'))}; } catch { fail('故事模板文件无法解析：' + name); } });
}
function validate(input, name, character) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('故事模板格式不正确：' + name);
  for (const key of ['slug', 'title', 'locale', 'characterId']) if (typeof input[key] !== 'string' || !input[key].trim() || input[key] !== input[key].trim()) fail('故事模板字段格式不正确：' + key + '（' + name + '）');
  if (input.definition === undefined) fail('故事模板缺少 definition：' + name);
  const snapshot = {schemaVersion: 1, characterId: input.characterId, name: character.name, personality: character.personality, background: character.background, greeting: character.greeting};
  const definitionJson = normalized(input.definition); const snapshotJson = normalized(snapshot);
  const parsed = readVersion(definitionJson, snapshotJson);
  if (parsed.characterId !== input.characterId) fail('角色快照与模板角色不一致：' + name);
  return {definition: input.definition, definitionJson, snapshotJson};
}
export async function publishStoryTemplates({dryRun = false, unpublish = false} = {}) {
  const files = readFiles(); const db = new PrismaClient({log: []});
  const result = {published: [], skipped: [], unpublished: [], dryRun};
  try {
    for (const {name, value} of files) {
      const character = await db.character.findUnique({where: {id: value?.characterId}});
      if (!character) fail('故事模板角色不存在：' + value?.characterId + '（' + name + '）');
      const checked = validate(value, name, character);
      const existing = await db.storyTemplate.findUnique({where: {slug: value.slug}, include: {versions: {orderBy: {version: 'desc'}, take: 1}}});
      const latest = existing?.versions[0]; const same = latest && hash(JSON.parse(latest.definitionJson)) === hash(checked.definition);
      if (dryRun) { result[same ? 'skipped' : 'published'].push({slug: value.slug, version: same ? latest.version : (latest?.version || 0) + 1}); continue; }
      if (unpublish) { if (existing) { await db.storyTemplate.update({where: {id: existing.id}, data: {status: 'OFFLINE'}}); result.unpublished.push(value.slug); } continue; }
      if (same) { result.skipped.push({slug: value.slug, version: latest.version}); continue; }
      const version = (latest?.version || 0) + 1;
      const template = await db.storyTemplate.upsert({where: {slug: value.slug}, update: {title: value.title, status: 'PUBLISHED'}, create: {slug: value.slug, title: value.title, status: 'PUBLISHED'} });
      await db.storyTemplateVersion.create({data: {templateId: template.id, version, locale: value.locale, definitionJson: checked.definitionJson, characterSnapshotJson: checked.snapshotJson, publishedAt: new Date()}});
      result.published.push({slug: value.slug, version});
    }
    return result;
  } finally { await db.$disconnect(); }
}
const args = new Set(process.argv.slice(2));
if (args.has('--dry-run') || args.has('--unpublish') || process.argv[1]?.endsWith('publish-story-template.mjs')) publishStoryTemplates({dryRun: args.has('--dry-run'), unpublish: args.has('--unpublish')}).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
