/**
 * 他眼中的你（Mirror）核心规则：
 * 结构校验失败只修复一次、匿名双路额度取较严者、分享视图不含三题原回答、删除后不可读。
 *
 * 生成链路用假的模型调用器（不碰真实供应商）；结果读写用临时 SQLite 库跑真实仓储代码。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = `mirror-generation-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.UPLOADS_DIRECTORY = path.resolve('artifacts', file, 'uploads');
process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.MIRROR_IP_SALT = 'test-salt-not-a-secret';
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);

const {db, pragmasReady} = await import('../src/lib/db.ts');
await pragmasReady;
const {generateMirrorResult, validateMirrorOutput, normalizeAnswers, buildMirrorPrompt} = await import('../src/lib/mirror/generation.ts');
const {consumeMirrorLimit, readMirrorUsage, releaseMirrorLimit, resetMirrorLimits, mirrorQuotaView, mirrorDayKey} = await import('../src/lib/mirror/limits.ts');
const identity = ({userId, cookieSubject, ipHash, cookieReportedCount = 0}) => ({userId, cookieSubject, ipHash, cookieReportedCount});
const {toPublicResult, toOwnerResult, isMirrorReadable, canDeleteMirrorResult, hashMirrorIp, signMirrorAttribution, verifyMirrorAttribution} = await import('../src/lib/mirror/share.ts');
const {readMirrorResult, deleteMirrorResult} = await import('../src/lib/mirror/repository.ts');

const rules = {questionCount: 3, answerMaxChars: 60, titleMaxChars: 8, observationMaxChars: 40, quoteMaxChars: 30, compareLimit: 3, resultRetentionDays: 30};
const limits = {titleMaxChars: rules.titleMaxChars, observationMaxChars: rules.observationMaxChars, quoteMaxChars: rules.quoteMaxChars};
const valid = JSON.stringify({title: '安静的观察者', observations: ['你说话前会先停一下', '你把关心藏在细节里', '你不喜欢被安排'], quote: '你比你以为的更温柔。', indices: {atmosphere: 72, rapport: 88}});
const fence = String.fromCharCode(96).repeat(3);
const broken = fence + 'json\n{"title": "只有称号"}\n' + fence;

function caller(responses) {
  const prompts = [];
  return {
    prompts,
    call: async prompt => {
      prompts.push(prompt);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return {text: next, metrics: {attempts: 1}};
    },
  };
}

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

test('结构不合格时只做一次格式修复，第二次合格即保存', async () => {
  const fake = caller([broken, valid]);
  const outcome = await generateMirrorResult({call: fake.call, prompt: 'first', repairPrompt: raw => 'repair:' + raw.length, limits});
  assert.equal(outcome.attempts, 2);
  assert.equal(outcome.repairUsed, true);
  assert.equal(fake.prompts.length, 2);
  assert.match(fake.prompts[1], /^repair:/);
  assert.deepEqual(outcome.fields.observations, ['你说话前会先停一下', '你把关心藏在细节里', '你不喜欢被安排']);
  assert.deepEqual(outcome.fields.indices, {atmosphere: 72, rapport: 88});
});

test('首次即合格时不再发起修复调用', async () => {
  const fake = caller([valid]);
  const outcome = await generateMirrorResult({call: fake.call, prompt: 'first', repairPrompt: () => 'repair', limits});
  assert.equal(outcome.attempts, 1);
  assert.equal(outcome.repairUsed, false);
  assert.equal(fake.prompts.length, 1);
});

test('修复后仍不合格就明确失败，不会第三次调用', async () => {
  const fake = caller([broken, '{"title": "还是缺字段"}']);
  await assert.rejects(generateMirrorResult({call: fake.call, prompt: 'first', repairPrompt: () => 'repair', limits}), error => error.code === 'MIRROR_STRUCTURE_INVALID');
  assert.equal(fake.prompts.length, 2);
});

test('结构校验拒绝缺观察、缺指数与非数字指数，并截断超长字段', async () => {
  assert.equal(validateMirrorOutput('{"title":"称号","observations":["a","b"],"quote":"q","indices":{"atmosphere":1,"rapport":2}}', limits).ok, false);
  assert.equal(validateMirrorOutput('{"title":"称号","observations":["a","b","c"],"quote":"q"}', limits).ok, false);
  assert.equal(validateMirrorOutput('{"title":"称号","observations":["a","b","c"],"quote":"q","indices":{"atmosphere":"高","rapport":2}}', limits).ok, false);
  const long = validateMirrorOutput(JSON.stringify({title: '一'.repeat(20), observations: ['a', 'b', 'c'], quote: '二'.repeat(50), indices: {atmosphere: 130, rapport: -5}}), limits);
  assert.equal(long.ok, true);
  assert.equal([...long.fields.title].length, limits.titleMaxChars);
  assert.equal([...long.fields.quote].length, limits.quoteMaxChars);
  assert.deepEqual(long.fields.indices, {atmosphere: 100, rapport: 0});
});

test('回答必须恰好题数且不超字数', () => {
  assert.deepEqual(normalizeAnswers([' 一 ', '二', '三'], rules), ['一', '二', '三']);
  assert.throws(() => normalizeAnswers(['一', '二'], rules), error => error.status === 400);
  assert.throws(() => normalizeAnswers(['一', '二', '三'.repeat(61)], rules), error => error.status === 400);
});

test('提示词把角色身份、字数上限与三道回答都带给模型', () => {
  const prompt = buildMirrorPrompt({template: '你是观察者。', character: {name: '林夏', tagline: '安静的画家', personality: '内敛', background: null, scenario: null}, answers: ['一', '二', '三'], rules});
  assert.match(prompt, /林夏/);
  assert.match(prompt, /不超过 8 字/);
  assert.match(prompt, /第3题回答：三/);
  assert.match(prompt, /observations/);
});

test('匿名额度 Cookie 与 IP 两路计数取较严者', () => {
  resetMirrorLimits();
  const day = mirrorDayKey(new Date('2026-10-21T04:00:00Z'), 'UTC');
  const ipHash = hashMirrorIp('203.0.113.9', 'salt');
  const first = identity({userId: null, cookieSubject: 'subject-a-0000000001', ipHash});
  assert.equal(consumeMirrorLimit(first, 1, day).allowed, true);
  // 同一浏览器第二次：Cookie 一路先到上限。
  assert.deepEqual(consumeMirrorLimit(first, 1, day), {allowed: false, channel: 'cookie', used: 1, limit: 1});
  // 换 Cookie（清缓存、换浏览器）但同一 IP：IP 一路拦住，取较严者的意义就在这里。
  const second = identity({userId: null, cookieSubject: 'subject-b-0000000002', ipHash});
  assert.deepEqual(consumeMirrorLimit(second, 1, day), {allowed: false, channel: 'ip', used: 1, limit: 1});
  assert.deepEqual(readMirrorUsage(second, day), {userUsed: 0, cookieUsed: 0, ipUsed: 1});
  // 换网络换 Cookie 才拿到新额度。
  assert.equal(consumeMirrorLimit(identity({userId: null, cookieSubject: 'subject-c-0000000003', ipHash: hashMirrorIp('198.51.100.4', 'salt')}), 1, day).allowed, true);
});

test('浏览器回传的当日用量也算进 Cookie 一路，服务端重启后额度不会复活', () => {
  resetMirrorLimits();
  const day = mirrorDayKey(new Date('2026-10-21T04:00:00Z'), 'UTC');
  const reported = identity({userId: null, cookieSubject: 'subject-reported-000001', ipHash: null, cookieReportedCount: 1});
  assert.equal(readMirrorUsage(reported, day).cookieUsed, 1);
  assert.deepEqual(consumeMirrorLimit(reported, 1, day), {allowed: false, channel: 'cookie', used: 1, limit: 1});
});

test('额度失败回退后可以重试，成功额度只算一次', () => {
  resetMirrorLimits();
  const day = mirrorDayKey(new Date('2026-10-21T04:00:00Z'), 'UTC');
  const who = identity({userId: null, cookieSubject: 'subject-retry-000000001', ipHash: hashMirrorIp('203.0.113.10', 'salt')});
  assert.equal(consumeMirrorLimit(who, 1, day).allowed, true);
  releaseMirrorLimit(who, day);
  assert.equal(readMirrorUsage(who, day).cookieUsed, 0);
  assert.equal(readMirrorUsage(who, day).ipUsed, 0);
  assert.equal(consumeMirrorLimit(who, 1, day).allowed, true);
  const view = mirrorQuotaView({identity: who, limit: 1, overLimitPolicy: 'PAUSE', timezone: 'UTC', purchasable: false, day});
  assert.equal(view.remaining, 0);
  assert.equal(view.canGenerate, false);
  assert.match(view.blockedReason, /次数已用完/);
});

test('登录用户不走匿名双路，额度只按用户维度计', () => {
  resetMirrorLimits();
  const day = mirrorDayKey(new Date('2026-10-21T04:00:00Z'), 'UTC');
  const who = identity({userId: 'user-1', cookieSubject: 'subject-login-00000001', ipHash: hashMirrorIp('203.0.113.11', 'salt')});
  for (let i = 0; i < 3; i++) assert.equal(consumeMirrorLimit(who, 3, day).allowed, true);
  assert.equal(consumeMirrorLimit(who, 3, day).allowed, false);
});

test('分享视图只有结果字段，绝不包含三题原回答', () => {
  const row = {shareId: 'share-1', userId: null, anonymousSubject: 'subject', characterId: 'char-1', title: '安静的观察者', observationsJson: JSON.stringify(['观察一', '观察二', '观察三']), quote: '金句', indicesJson: JSON.stringify({atmosphere: 72, rapport: 88}), status: 'READY', createdAt: new Date('2026-10-21T00:00:00Z'), expiresAt: null};
  const view = toPublicResult(row, {id: 'char-1', name: '林夏', avatarUrl: null});
  const serialized = JSON.stringify(view);
  assert.deepEqual(Object.keys(view).sort(), ['characterAvatarUrl', 'characterId', 'characterName', 'createdAt', 'expiresAt', 'indices', 'observations', 'quote', 'shareId', 'title']);
  assert.equal(serialized.includes('answers'), false);
  assert.equal(serialized.includes('原回答秘密'), false);
  const owner = toOwnerResult(view, ['原回答秘密'], true);
  assert.deepEqual(owner.answers, ['原回答秘密']);
});

test('删除后读不到：本人可删，别人 403，删除后一律 404', async () => {
  const user = await db.user.create({data: {username: 'mirror-owner', email: 'mirror-owner@example.invalid', passwordHash: 'synthetic-only'}});
  const other = await db.user.create({data: {username: 'mirror-other', email: 'mirror-other@example.invalid', passwordHash: 'synthetic-only'}});
  const character = await db.character.create({data: {name: '林夏', personality: '内敛', background: '画家', isPublic: true, reviewStatus: 'APPROVED'}});
  const shareId = 'share' + randomUUID().replace(/-/g, '').slice(0, 12);
  await db.mirrorResult.create({data: {shareId, userId: user.id, characterId: character.id, answersJson: JSON.stringify(['一', '二', '三']), title: '安静的观察者', observationsJson: JSON.stringify(['观察一', '观察二', '观察三']), quote: '金句', indicesJson: JSON.stringify({atmosphere: 72, rapport: 88}), status: 'READY'}});

  const ownerView = await readMirrorResult(shareId, {userId: user.id, subject: null});
  assert.equal(ownerView.kind, 'owner');
  const strangerView = await readMirrorResult(shareId, {userId: other.id, subject: null});
  assert.equal(strangerView.kind, 'public');
  assert.equal(JSON.stringify(strangerView).includes('"answers"'), false);

  await assert.rejects(deleteMirrorResult(shareId, {userId: other.id, subject: null}, null), error => error.status === 403);
  await deleteMirrorResult(shareId, {userId: user.id, subject: null}, null);
  await assert.rejects(readMirrorResult(shareId, {userId: user.id, subject: null}), error => error.status === 404);
  await assert.rejects(deleteMirrorResult(shareId, {userId: user.id, subject: null}, null), error => error.status === 404);
});

test('匿名结果凭创建时签发的归属凭据删除，伪造凭据无效', async () => {
  const character = await db.character.create({data: {name: '陆迟', personality: '直接', background: '记者', isPublic: true, reviewStatus: 'APPROVED'}});
  const shareId = 'share' + randomUUID().replace(/-/g, '').slice(0, 12);
  const subject = 'subject-owner-00000001';
  await db.mirrorResult.create({data: {shareId, userId: null, anonymousSubject: subject, characterId: character.id, answersJson: JSON.stringify(['一', '二', '三']), title: '称号', observationsJson: JSON.stringify(['a', 'b', 'c']), quote: 'q', indicesJson: JSON.stringify({atmosphere: 1, rapport: 2}), status: 'READY', expiresAt: new Date(Date.now() + 86400000)}});
  const token = signMirrorAttribution(subject, shareId);
  assert.equal(verifyMirrorAttribution({subject, shareId, token}), true);
  assert.equal(verifyMirrorAttribution({subject, shareId: shareId + 'x', token}), false);
  assert.equal(canDeleteMirrorResult({row: {userId: null, anonymousSubject: subject}, viewer: {userId: null, subject}, attributionValid: false}), false);
  await assert.rejects(deleteMirrorResult(shareId, {userId: null, subject}, 'forged'), error => error.status === 403);
  const owner = await readMirrorResult(shareId, {userId: null, subject}, token);
  assert.equal(owner.kind, 'owner');
  await deleteMirrorResult(shareId, {userId: null, subject}, token);
  await assert.rejects(readMirrorResult(shareId, {userId: null, subject}, token), error => error.status === 404);
});

test('过期的结果同样读不到', async () => {
  const character = await db.character.create({data: {name: '过期角色', personality: 'x', background: 'y', isPublic: true, reviewStatus: 'APPROVED'}});
  const shareId = 'share' + randomUUID().replace(/-/g, '').slice(0, 12);
  await db.mirrorResult.create({data: {shareId, userId: null, anonymousSubject: 'subject-expired-000001', characterId: character.id, answersJson: JSON.stringify(['一', '二', '三']), title: '称号', observationsJson: JSON.stringify(['a', 'b', 'c']), quote: 'q', indicesJson: JSON.stringify({atmosphere: 1, rapport: 2}), status: 'READY', expiresAt: new Date(Date.now() - 1000)}});
  assert.equal(isMirrorReadable({status: 'READY', expiresAt: new Date(Date.now() - 1000)}), false);
  await assert.rejects(readMirrorResult(shareId, {userId: null, subject: null}), error => error.status === 404);
});