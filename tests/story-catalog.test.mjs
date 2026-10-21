import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = 'story-catalog-' + process.pid + '-' + Date.now() + '.db';
const databasePath = path.resolve('prisma', file);
process.env.DATABASE_URL = 'file:' + databasePath.replace(/\\/g, '/');
const env = {...process.env}; delete env.RUST_LOG;
const {createIsolatedDatabase} = await import('../scripts/helpers/create-isolated-db.mjs');
createIsolatedDatabase(databasePath);
const {db} = await import('../src/lib/db.ts');
const {GET: list} = await import('../src/app/api/stories/route.ts');
const {GET: detail} = await import('../src/app/api/stories/[slug]/route.ts');
const {publicStoryKeys} = await import('../src/lib/stories/catalog-service.ts');
test.beforeEach(async () => {
  await db.storyTemplate.deleteMany();
  await db.character.deleteMany();
  await db.user.deleteMany();
});
test.after(async () => { await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true}); });

async function makeStory({slug = randomUUID(), status = 'PUBLISHED', publishedAt = new Date(Date.now() - 1000), versions = [1], locale = 'zh'} = {}) {
  const owner = await db.user.create({data: {username: 'u' + randomUUID(), email: randomUUID() + '@example.invalid', passwordHash: 'synthetic'}});
  const character = await db.character.create({data: {creatorId: owner.id, name: '角色公开名', tagline: '公开短句', avatarUrl: '/public.png', personality: 'PRIVATE_PERSONALITY', background: 'private background', isPublic: true, reviewStatus: 'APPROVED'}});
  const template = await db.storyTemplate.create({data: {slug, title: '故事 ' + slug, status}});
  const createdVersions = [];
  for (const versionNo of versions) {
    const definitionJson = JSON.stringify({schemaVersion: 1, publicSummary: 'PUBLIC_SUMMARY_' + versionNo, chapters: [{key: 'opening', title: '章节 ' + versionNo}], hiddenFacts: 'HIDDEN_' + versionNo, internalRules: 'PRIVATE_RULES'});
    const version = await db.storyTemplateVersion.create({data: {templateId: template.id, version: versionNo, locale, publishedAt, definitionJson, characterSnapshotJson: JSON.stringify({schemaVersion: 1, characterId: character.id, prompt: 'FULL_PRIVATE_PROMPT', secret: 'PRIVATE_SNAPSHOT'})}});
    createdVersions.push(version);
  }
  return {owner, character, template, versions: createdVersions};
}

async function callList(url = 'http://local.test/api/stories', headers = {}) { return list(new Request(url, {headers})); }
async function callDetail(slug, headers = {}) { return detail(new Request('http://local.test/api/stories/' + slug, {headers}), {params: Promise.resolve({slug})}); }
async function assertWhitelist(body) {
  // The detail endpoint wraps the story in {story} (matching the list's {items, nextCursor});
  // everything else asserts on the story object itself.
  if (body && typeof body === 'object' && 'story' in body) {
    assert.deepEqual(Object.keys(body).sort(), ['story']);
    body = body.story;
  }
  assert.deepEqual(Object.keys(body).sort(), [...publicStoryKeys].sort());
  assert.equal(JSON.stringify(body).includes('hiddenFacts'), false);
  assert.equal(JSON.stringify(body).includes('definitionJson'), false);
  assert.equal(JSON.stringify(body).includes('characterSnapshotJson'), false);
  assert.equal(JSON.stringify(body).includes('stateJson'), false);
  assert.equal(JSON.stringify(body).includes('HIDDEN_'), false);
  assert.equal(JSON.stringify(body).includes('FULL_PRIVATE_PROMPT'), false);
  assert.equal(JSON.stringify(body).includes('PRIVATE_SNAPSHOT'), false);
}

test('anonymous catalog only lists published templates with a released version', async () => {
  const published = await makeStory({slug: 'published-ready'});
  await makeStory({slug: 'draft-template', status: 'DRAFT'});
  await makeStory({slug: 'offline-template', status: 'OFFLINE'});
  await makeStory({slug: 'future-version', publishedAt: new Date(Date.now() + 86400000)});
  const response = await callList();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.items.map(item => item.slug), [published.template.slug]);
  await assertWhitelist(body.items[0]);
});

test('slug detail is anonymous and missing or offline stories both return 404', async () => {
  const story = await makeStory({slug: 'public-detail'});
  const ok = await callDetail(story.template.slug);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  await assertWhitelist(body);
  assert.equal(body.story.characterName, story.character.name);
  assert.equal(body.story.characterTagline, story.character.tagline);
  assert.equal((await callDetail('missing-slug')).status, 404);
  await db.storyTemplate.update({where: {id: story.template.id}, data: {status: 'OFFLINE'}});
  assert.equal((await callDetail(story.template.slug)).status, 404);
});

test('latest released version is selected and future versions are ignored', async () => {
  const story = await makeStory({slug: 'versioned-story', versions: [1, 2]});
  await db.storyTemplateVersion.create({data: {templateId: story.template.id, version: 99, locale: 'zh', publishedAt: new Date(Date.now() + 86400000), definitionJson: JSON.stringify({schemaVersion: 1, publicSummary: 'FUTURE', chapters: [{key: 'future', title: '未来'}]}), characterSnapshotJson: JSON.stringify({schemaVersion: 1, characterId: story.character.id})}});
  const response = await callDetail(story.template.slug);
  const body = await response.json();
  assert.equal(body.story.templateVersionId, story.versions[1].id);
  assert.equal(body.story.publicSummary, 'PUBLIC_SUMMARY_2');
  assert.deepEqual(body.story.chapters, [{key: 'opening', title: '章节 2'}]);
  await assertWhitelist(body);
});

test('limit is capped at 50 and opaque cursor pages without duplicates', async () => {
  for (let i = 0; i < 53; i++) await makeStory({slug: 'page-' + String(i).padStart(2, '0')});
  const first = await (await callList('http://local.test/api/stories?limit=500')).json();
  assert.equal(first.items.length, 50);
  assert.ok(first.nextCursor);
  const second = await (await callList('http://local.test/api/stories?limit=50&cursor=' + encodeURIComponent(first.nextCursor))).json();
  assert.equal(second.items.length, 3);
  const ids = [...first.items, ...second.items].map(item => item.slug);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal((await callList('http://local.test/api/stories?limit=0')).status, 422);
});

test('locale filter selects the newest version for that locale', async () => {
  const story = await makeStory({slug: 'localized', versions: [1], locale: 'en'});
  await db.storyTemplateVersion.create({data: {templateId: story.template.id, version: 2, locale: 'zh', publishedAt: new Date(), definitionJson: JSON.stringify({schemaVersion: 1, publicSummary: '中文摘要', chapters: [{key: 'opening', title: '中文章节'}]}), characterSnapshotJson: JSON.stringify({schemaVersion: 1, characterId: story.character.id})}});
  const body = await (await callList('http://local.test/api/stories?locale=zh')).json();
  const localized = body.items.find(item => item.slug === story.template.slug);
  assert.ok(localized);
  assert.equal(localized.locale, 'zh');
  assert.equal(localized.publicSummary, '中文摘要');
});
