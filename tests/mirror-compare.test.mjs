import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

/**
 * 多角色对比（V3 §23）。
 *
 * 覆盖：上限从服务端设置读并截断、每条独立带状态（失败不影响其他条目）、
 * 对比响应里任何一条都没有三题原回答、未登录 401。
 * 走真实路由处理器与临时 SQLite 库，不 mock 业务层。
 */

const file = `mirror-compare-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.UPLOADS_DIRECTORY = path.resolve('artifacts', file, 'uploads');
process.env.JWT_SECRET = randomUUID() + randomUUID();
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);

const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {compareMirrorResults} = await import('../src/lib/mirror/repository.ts');
const {saveGroup} = await import('../src/lib/settings/service.ts');
const {clearCache} = await import('../src/lib/settings/cache.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {GET: compareRoute} = await import('../src/app/api/mirror/compare/route.ts');

const [owner, stranger] = await Promise.all([
  db.user.create({data: {username: 'compare_owner', email: 'compare-owner@example.invalid', passwordHash: 'synthetic-only'}}),
  db.user.create({data: {username: 'compare_stranger', email: 'compare-stranger@example.invalid', passwordHash: 'synthetic-only'}}),
]);

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

/** 造一条真实结果；answers 故意带特征串，任何泄漏都能被断言抓到。 */
async function makeResult(userId, name, overrides = {}) {
  const character = await db.character.create({data: {name, personality: '安静', background: '合成背景', isPublic: true, reviewStatus: 'APPROVED'}});
  const shareId = 'cmp' + randomUUID().replace(/-/g, '').slice(0, 12);
  await db.mirrorResult.create({data: {
    shareId, userId, characterId: character.id,
    answersJson: JSON.stringify([`${name} 原回答一`, `${name} 原回答二`, `${name} 原回答三`]),
    title: name + '的称号',
    observationsJson: JSON.stringify([`${name} 观察一`, `${name} 观察二`, `${name} 观察三`]),
    quote: `${name} 的金句`,
    indicesJson: JSON.stringify({atmosphere: 70, rapport: 80}),
    status: 'READY',
    ...overrides,
  }});
  return shareId;
}

const tokenOf = async user => 'Bearer ' + await signToken({userId: user.id, email: user.email, tokenVersion: user.tokenVersion});
const compareUrl = ids => 'http://localhost/api/mirror/compare?' + ids.map(id => 'shareId=' + encodeURIComponent(id)).join('&');

test('上限从服务端设置读：compareLimit 改成 2 后只返回前两条', async () => {
  const ids = [];
  for (const name of ['甲', '乙', '丙']) ids.push(await makeResult(owner.id, name));

  // 默认 3：三条都回来。
  const three = await compareMirrorResults(ids, 3);
  assert.deepEqual(three.map(entry => entry.status), ['READY', 'READY', 'READY']);

  // 通过真实的设置服务把 mirror.compareLimit 改成 2，路由必须跟着变。
  await saveGroup({group: 'growth', changes: [{key: 'mirror.compareLimit', value: 2}], expectedVersions: {}, operatorId: 'compare-test'});
  clearCache();
  const response = await compareRoute(new Request(compareUrl(ids), {headers: {Authorization: await tokenOf(owner)}}));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.compareLimit, 2, '上限来自设置而不是前端常量');
  assert.equal(body.entries.length, 2, '超出的那条被截断');
  assert.deepEqual(body.entries.map(entry => entry.shareId), ids.slice(0, 2));

  // 恢复默认，后面的用例按 3 跑。
  await saveGroup({group: 'growth', changes: [{key: 'mirror.compareLimit', value: 3}], expectedVersions: {}, operatorId: 'compare-test'});
  clearCache();
});

test('失败条目不影响其他条目：已删除、过期、不存在的各给一条 FAILED，其余照常 READY', async () => {
  const live = await makeResult(owner.id, '丁');
  const hidden = await makeResult(owner.id, '戊', {status: 'HIDDEN'});
  const expired = await makeResult(owner.id, '己', {expiresAt: new Date(Date.now() - 86_400_000)});
  const missing = 'cmpdoesnotexist0001';

  const entries = await compareMirrorResults([live, hidden, expired, missing], 6);
  assert.deepEqual(entries.map(entry => entry.status), ['READY', 'FAILED', 'FAILED', 'FAILED']);
  // 顺序与请求顺序一致，前台能按位置对上。
  assert.deepEqual(entries.map(entry => entry.shareId), [live, hidden, expired, missing]);
  assert.match(entries[1].reason, /已删除或已过期/);
  assert.match(entries[2].reason, /已删除或已过期/);
  assert.match(entries[3].reason, /不存在/);

  // 成功那条仍然完整。
  assert.equal(entries[0].result.characterName, '丁');
  assert.equal(entries[0].result.title, '丁的称号');
  assert.equal(entries[0].result.observations.length, 3);

  // 单独重取失败那一条：只回一条，且只读不生成。
  const single = await compareMirrorResults([hidden], 6);
  assert.equal(single.length, 1);
  assert.equal(single[0].status, 'FAILED');
});

test('别人的结果拿不到 answers：对比响应里一条都没有', async () => {
  const mine = await makeResult(owner.id, '庚');
  const others = await makeResult(stranger.id, '辛');

  const body = await (await compareRoute(new Request(compareUrl([mine, others]), {headers: {Authorization: await tokenOf(owner)}}))).json();
  assert.equal(body.entries.length, 2);
  assert.deepEqual(body.entries.map(entry => entry.status), ['READY', 'READY']);

  // 别人那条：公开字段齐全，但没有 answers 键。
  const other = body.entries[1].result;
  assert.equal(other.characterName, '辛');
  assert.equal('answers' in other, false);
  // 自己那条同样不带：对比是结构上就看不到原回答，不靠渲染层自觉。
  assert.equal('answers' in body.entries[0].result, false);

  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('"answers"'), false);
  for (const name of ['庚', '辛']) assert.equal(serialized.includes(`${name} 原回答`), false, '原回答不得出现在对比响应里');
});

test('未登录 401，且没有 shareId 时返回空列表', async () => {
  const anonymous = await compareRoute(new Request(compareUrl(['cmpanything000001'])));
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).code, 'MIRROR_LOGIN_REQUIRED');

  const empty = await compareRoute(new Request('http://localhost/api/mirror/compare', {headers: {Authorization: await tokenOf(owner)}}));
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).entries, []);
});
