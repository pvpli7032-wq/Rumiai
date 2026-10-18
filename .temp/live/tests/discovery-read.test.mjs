import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = `discovery-read-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const migrationEnv = {...process.env}; delete migrationEnv.RUST_LOG;
const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env: migrationEnv, encoding: 'utf8', windowsHide: true});
assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);

const {db} = await import('../src/lib/db.ts');
const {GET: readHoroscope} = await import('../src/app/api/horoscope/[sign]/route.ts');
const {GET: listUniverses} = await import('../src/app/api/universes/route.ts');
const {GET: readRankings} = await import('../src/app/api/rankings/route.ts');
const {GET: listGiftLeaderboard} = await import('../src/app/api/leaderboard/gifts/route.ts');
const {readExploreCatalog} = await import('../src/lib/discovery/read-service.ts');
test.after(async () => {await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});});

test('discovery and ranking HTTP adapters read their own domains and preserve public filters and aggregates', async () => {
  const user = await db.user.create({data: {username: 'discovery_creator', email: 'discovery@example.invalid', passwordHash: 'synthetic-only'}});
  const visible = await db.character.create({data: {creatorId: user.id, name: '公开榜单角色', personality: 'synthetic', background: '', isPublic: true, reviewStatus: 'APPROVED', chatCount: 8, createdAt: new Date('2026-10-14T00:00:00.000Z')}});
  const hidden = await db.character.create({data: {creatorId: user.id, name: '私有榜单角色', personality: 'synthetic', background: '', isPublic: false, reviewStatus: 'DRAFT', chatCount: 90}});
  await db.gift.create({data: {senderId: user.id, characterId: visible.id, amount: 4}});
  await db.gift.create({data: {senderId: user.id, characterId: visible.id, amount: 6}});
  await db.universe.create({data: {name: '公开世界', description: '公开', isPublic: true, chatCount: 5}});
  await db.universe.create({data: {name: '私有世界', description: '私有', isPublic: false, chatCount: 50}});
  await db.horoscope.create({data: {sign: 'aries', thaiName: 'เมษ', title: 'synthetic', description: 'synthetic', luckyNumber: 7, luckyColor: 'blue', compatibility: 'synthetic', advice: 'synthetic'}});
  await db.tag.create({data: {key: 'test-tag', label: '测试标签', group: 'GENRE'}});
  await db.character.update({where: {id: visible.id}, data: {tags: 'test-tag'}});
  await db.conversation.create({data: {userId: user.id, characterId: visible.id}});

  const zodiac = await readHoroscope(new Request('http://local.test/api/horoscope/ARIES'), {params: Promise.resolve({sign: 'ARIES'})});
  assert.equal(zodiac.status, 200); assert.equal((await zodiac.json()).sign, 'aries');
  assert.equal((await readHoroscope(new Request('http://local.test/api/horoscope/unknown'), {params: Promise.resolve({sign: 'unknown'})})).status, 400);
  const universes = await listUniverses();
  assert.deepEqual((await universes.json()).map(row => row.name), ['公开世界']);
  const exploreCatalog = await readExploreCatalog();
  assert.equal(exploreCatalog.total, 1);
  assert.equal(exploreCatalog.characters[0].id, visible.id);
  assert.equal(exploreCatalog.characters[0].conversationCount, 1);
  assert.equal(exploreCatalog.labelByKey['test-tag'], '测试标签');
  const rankings = await readRankings(); const rankingData = await rankings.json();
  assert.equal(rankingData.characters[0].id, visible.id); assert(!rankingData.characters.some(row => row.id === hidden.id));
  assert.equal(rankingData.topGifted[0].giftAmount, 10); assert.equal(rankingData.topGifted[0].giftCount, 2);
  const gifts = await listGiftLeaderboard(new Request('http://local.test/api/leaderboard/gifts'));
  assert.deepEqual(await gifts.json(), [{rank: 1, characterId: visible.id, name: visible.name, avatarUrl: null, giftAmount: 10, giftCount: 2}]);
});
