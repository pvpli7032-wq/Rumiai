import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const file = 'story-publish-' + process.pid + '-' + Date.now() + '.db';
const databasePath = path.resolve('prisma', file);
process.env.DATABASE_URL = 'file:' + databasePath.replaceAll('\\\\', '/');
const {createIsolatedDatabase} = await import('../scripts/helpers/create-isolated-db.mjs');
createIsolatedDatabase(databasePath);
const {PrismaClient} = await import('@prisma/client');
const db = new PrismaClient({datasources: {db: {url: process.env.DATABASE_URL}}});
const {publishStoryTemplates} = await import('../scripts/publish-story-template.mjs');
const contentDir = path.resolve('content', 'stories-test-' + process.pid);
mkdirSync(contentDir, {recursive: true});
process.env.STORY_CONTENT_DIR = contentDir;
const name = randomUUID();
const character = await db.character.create({data: {name: '发布角色', personality: 'CALM', background: '测试', greeting: '你好'}});
function write(value) { writeFileSync(path.join(contentDir, 'story.json'), JSON.stringify(value)); }
function fixture(chapters = [{key: 'opening', title: '开场'}]) { return {slug: name, title: '测试故事', locale: 'zh', characterId: character.id, definition: {schemaVersion: 1, publicSummary: '公开摘要', chapters}}; }
// The CLI reads STORY_CONTENT_DIR at module load; tests invoke it in a child process for isolation.
async function invoke(args = [], value = fixture()) { write(value); const {spawnSync} = await import('node:child_process'); const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/publish-story-template.mjs', ...args], {encoding: 'utf8', env: {...process.env, DATABASE_URL: process.env.DATABASE_URL, STORY_CONTENT_DIR: contentDir}}); assert.equal(result.status, 0, result.stdout + result.stderr); return JSON.parse(result.stdout); }
test.after(async () => { await db.$disconnect(); rmSync(databasePath, {force: true}); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(databasePath + suffix, {force: true}); rmSync(contentDir, {recursive: true, force: true}); });
test('publishes and repeated content is idempotent', async () => { const first = await invoke(); assert.equal(first.published[0].version, 1); const second = await invoke(); assert.equal(second.skipped[0].version, 1); assert.equal(await db.storyTemplateVersion.count(), 1); });
test('definition changes create next version', async () => { await invoke(); const changed = fixture([{key: 'opening', title: '新开场'}, {key: 'next', title: '下一章'}]); const result = await invoke([], changed); assert.equal(result.published[0].version, 2); assert.equal(await db.storyTemplateVersion.count(), 2); });
test('duplicate chapter keys and unknown characters fail validation', async () => { const duplicate = fixture([{key: 'opening', title: '一'}, {key: 'opening', title: '二'}]); const {spawnSync} = await import('node:child_process'); write(duplicate); let result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/publish-story-template.mjs'], {encoding: 'utf8', env: {...process.env, DATABASE_URL: process.env.DATABASE_URL, STORY_CONTENT_DIR: contentDir}}); assert.notEqual(result.status, 0); assert.match(result.stderr, /故事版本数据不完整/); write({...fixture(), characterId: 'missing-character'}); result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/publish-story-template.mjs'], {encoding: 'utf8', env: {...process.env, DATABASE_URL: process.env.DATABASE_URL, STORY_CONTENT_DIR: contentDir}}); assert.notEqual(result.status, 0); assert.match(result.stderr, /故事模板角色不存在/); });
test('dry-run validates without writing', async () => { const result = await invoke(['--dry-run']); assert.equal(result.dryRun, true); assert.equal(result.published[0].version, 3); assert.equal(await db.storyTemplateVersion.count(), 2); });
