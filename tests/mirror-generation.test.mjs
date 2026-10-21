/**
 * 他眼中的你（Mirror）核心规则：
 * 结构校验失败只修复一次、匿名双通道额度（Cookie 1 次 / IP 10 次，取较严者）、
 * 业务日重置、推广角色名单与自动回退、分享视图不含三题原回答、删除后不可读。
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
const {consumeMirrorLimit, readMirrorUsage, readMirrorLimitState, releaseMirrorLimit, resetMirrorLimits, mirrorQuotaView, mirrorDayKey} = await import('../src/lib/mirror/limits.ts');
const {toPublicResult, toOwnerResult, isMirrorReadable, canDeleteMirrorResult, hashMirrorIp, signMirrorAttribution, verifyMirrorAttribution} = await import('../src/lib/mirror/share.ts');
const {readMirrorResult, deleteMirrorResult} = await import('../src/lib/mirror/repository.ts');
const {clearCache} = await import('../src/lib/settings/cache.ts');
const {purchasePlanOf, purchaseBlockedReason, readPurchasedToday} = await import('../src/lib/mirror/purchase.ts');
const {listMirrorCharacters} = await import('../src/lib/mirror/service.ts');

const identity = ({userId, cookieSubject, ipHash, cookieReportedCount = 0}) => ({userId, cookieSubject, ipHash, cookieReportedCount});
/** V3 表 9 的默认额度：登录 3 次、Cookie 1 次、同一 IP 10 次。 */
const PLAN = {userLimit: 3, cookieLimit: 1, ipLimit: 10};
const plan = (overrides = {}) => ({...PLAN, ...overrides});
const purchase = {enabled: false, coins: 0, available: false};

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

/** 直接写设置行再清缓存：模拟运营在后台改了一项配置。 */
async function setSetting(key, value, group = 'growth') {
  await db.operationSetting.upsert({
    where: {key},
    create: {key, group, value: JSON.stringify(value), updatedBy: 'test'},
    update: {value: JSON.stringify(value)},
  });
  clearCache();
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

test('Cookie 通道上限 1 次：同一浏览器第二次就被拒', () => {
  resetMirrorLimits();
  const day = mirrorDayKey(new Date('2026-10-21T04:00:00Z'), 'UTC');
  const who = identity({userId: null, cookieSubject: 'subject-cookie-0000001', ipHash: hashMirrorIp('203.0.113.9', 'salt')});
  assert.equal(consumeMirrorLimit(who, plan(), day).allowed, true);
  assert.deepEqual(consumeMirrorLimit(who, plan(), day), {allowed: false, channel: 'cookie', used: 1, limit: 1});
});

test('IP 通道上限 10 次：同一出口换 10 个 Cookie 后第 11 次被拒', () => {
  resetMirrorLimits();
  const day = mirrorDayKey(new Date('2026-10-21T04:00:00Z'), 'UTC');
  const ipHash = hashMirrorIp('203.0.113.20', 'salt');
  // 每次换一个浏览器（不同 Cookie 主体），Cookie 通道各自都是第 1 次，只有 IP 通道在累加。
  for (let i = 0; i < 10; i++) {
    const who = identity({userId: null, cookieSubject: `subject-ip-pass-${i.toString().padStart(8, '0')}`, ipHash});
    assert.equal(consumeMirrorLimit(who, plan(), day).allowed, true, `第 ${i + 1} 次应放行`);
  }
  const eleventh = identity({userId: null, cookieSubject: 'subject-ip-pass-00000010', ipHash});
  assert.deepEqual(consumeMirrorLimit(eleventh, plan(), day), {allowed: false, channel: 'ip', used: 10, limit: 10});
  assert.equal(readMirrorUsage(eleventh, day).ipUsed, 10);
  // 换一个网络就能继续：说明拦住的是 IP 通道，不是全局计数。
  assert.equal(consumeMirrorLimit(identity({userId: null, cookieSubject: 'subject-ip-pass-00000011', ipHash: hashMirrorIp('198.51.100.20', 'salt')}), plan(), day).allowed, true);
});

test('两条通道取较严者：Cookie 还有余量但 IP 到顶，依然拒绝', () => {
  resetMirrorLimits();
  const day = mirrorDayKey(new Date('2026-10-21T04:00:00Z'), 'UTC');
  const ipHash = hashMirrorIp('203.0.113.30', 'salt');
  for (let i = 0; i < 10; i++) {
    consumeMirrorLimit(identity({userId: null, cookieSubject: `subject-strict-${i.toString().padStart(8, '0')}`, ipHash}), plan(), day);
  }
  // 全新浏览器：Cookie 通道 0/1 完全没用过，但 IP 通道已经 10/10。
  const fresh = identity({userId: null, cookieSubject: 'subject-strict-brand-new', ipHash});
  const state = readMirrorLimitState(fresh, plan(), day);
  assert.deepEqual(state.channels.cookie, {used: 0, limit: 1, remaining: 1});
  assert.deepEqual(state.channels.ip, {used: 10, limit: 10, remaining: 0});
  // 生效通道是较严的 IP，剩余 0。
  assert.equal(state.remaining, 0);
  assert.equal(state.limit, 10);
  assert.equal(state.used, 10);
  assert.equal(consumeMirrorLimit(fresh, plan(), day).allowed, false);
});

test('业务日重置：换一天两条通道都从零开始', () => {
  resetMirrorLimits();
  const today = mirrorDayKey(new Date('2026-10-21T04:00:00Z'), 'UTC');
  const tomorrow = mirrorDayKey(new Date('2026-10-22T04:00:00Z'), 'UTC');
  assert.notEqual(today, tomorrow);
  const ipHash = hashMirrorIp('203.0.113.40', 'salt');
  const who = identity({userId: null, cookieSubject: 'subject-reset-0000001', ipHash});
  assert.equal(consumeMirrorLimit(who, plan(), today).allowed, true);
  assert.equal(consumeMirrorLimit(who, plan(), today).allowed, false);
  // 第二天同一个浏览器、同一个 IP：两条通道都重新开始。
  assert.equal(readMirrorUsage(who, tomorrow).cookieUsed, 0);
  assert.equal(readMirrorUsage(who, tomorrow).ipUsed, 0);
  assert.equal(consumeMirrorLimit(who, plan(), tomorrow).allowed, true);
});

test('业务日按配置时区切换：UTC 与东八区的跨日时刻不同', () => {
  // 2026-10-21T20:00Z = 东八区 10-22 04:00，UTC 仍是 10-21。
  const at = new Date('2026-10-21T20:00:00Z');
  assert.equal(mirrorDayKey(at, 'UTC'), '2026-10-21');
  assert.equal(mirrorDayKey(at, 'Asia/Shanghai'), '2026-10-22');
});

test('浏览器回传的当日用量也算进 Cookie 一路，服务端重启后额度不会复活', () => {
  resetMirrorLimits();
  const day = mirrorDayKey(new Date('2026-10-21T04:00:00Z'), 'UTC');
  const reported = identity({userId: null, cookieSubject: 'subject-reported-000001', ipHash: null, cookieReportedCount: 1});
  assert.equal(readMirrorUsage(reported, day).cookieUsed, 1);
  assert.deepEqual(consumeMirrorLimit(reported, plan(), day), {allowed: false, channel: 'cookie', used: 1, limit: 1});
});

test('额度失败回退后可以重试，成功额度只算一次', () => {
  resetMirrorLimits();
  const day = mirrorDayKey(new Date('2026-10-21T04:00:00Z'), 'UTC');
  const who = identity({userId: null, cookieSubject: 'subject-retry-000000001', ipHash: hashMirrorIp('203.0.113.10', 'salt')});
  assert.equal(consumeMirrorLimit(who, plan(), day).allowed, true);
  releaseMirrorLimit(who, day);
  assert.equal(readMirrorUsage(who, day).cookieUsed, 0);
  assert.equal(readMirrorUsage(who, day).ipUsed, 0);
  assert.equal(consumeMirrorLimit(who, plan(), day).allowed, true);
  releaseMirrorLimit(who, day);
  const view = mirrorQuotaView({identity: who, plan: plan(), overLimitPolicy: 'PAUSE', timezone: 'UTC', purchasable: false, purchase, day});
  assert.equal(view.remaining, 1);
  assert.equal(view.canGenerate, true);
  assert.equal(view.blockedReason, null);
});

test('登录用户不走匿名双路，额度只按用户维度计', () => {
  resetMirrorLimits();
  const day = mirrorDayKey(new Date('2026-10-21T04:00:00Z'), 'UTC');
  const who = identity({userId: 'user-1', cookieSubject: 'subject-login-00000001', ipHash: hashMirrorIp('203.0.113.11', 'salt')});
  for (let i = 0; i < 3; i++) assert.equal(consumeMirrorLimit(who, plan(), day).allowed, true);
  assert.deepEqual(consumeMirrorLimit(who, plan(), day), {allowed: false, channel: 'user', used: 3, limit: 3});
  // 登录用户不吃匿名通道：IP 通道一次都没被占用。
  assert.equal(readMirrorUsage(who, day).ipUsed, 0);
  const state = readMirrorLimitState(who, plan(), day);
  assert.deepEqual(state.channels, {cookie: null, ip: null});
});

test('上限设为 0 表示暂停，文案说「暂停」而不是「用完了」', () => {
  resetMirrorLimits();
  const day = mirrorDayKey(new Date('2026-10-21T04:00:00Z'), 'UTC');
  const who = identity({userId: null, cookieSubject: 'subject-paused-0000001', ipHash: hashMirrorIp('203.0.113.50', 'salt')});
  const view = mirrorQuotaView({identity: who, plan: plan({ipLimit: 0}), overLimitPolicy: 'PAUSE', timezone: 'UTC', purchasable: false, purchase, day});
  assert.equal(view.canGenerate, false);
  assert.match(view.blockedReason, /暂停生成/);
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

test('推广角色名单为空时回退自动选取', async () => {
  await setSetting('mirror.featuredCharacterIds', []);
  await db.character.create({data: {name: '自动角色甲', personality: 'x', background: 'y', isPublic: true, reviewStatus: 'APPROVED', isExclusive: true, chatCount: 50}});
  const list = await listMirrorCharacters();
  assert(list.length > 0);
  assert(list.every(item => item.source === 'AUTO'));
  assert.equal(list[0].name, '自动角色甲');
});

test('推广角色名单按数组顺序取，失效 id 直接跳过', async () => {
  const first = await db.character.create({data: {name: '指定角色一', personality: 'x', background: 'y', isPublic: true, reviewStatus: 'APPROVED'}});
  const second = await db.character.create({data: {name: '指定角色二', personality: 'x', background: 'y', isPublic: true, reviewStatus: 'APPROVED'}});
  const hidden = await db.character.create({data: {name: '已下架角色', personality: 'x', background: 'y', isPublic: false, reviewStatus: 'APPROVED'}});
  const pending = await db.character.create({data: {name: '待审核角色', personality: 'x', background: 'y', isPublic: true, reviewStatus: 'PENDING'}});
  // 顺序故意打乱，并混入不存在、已下架、待审核三种失效项。
  await setSetting('mirror.featuredCharacterIds', [second.id, 'no-such-character', hidden.id, first.id, pending.id]);

  const list = await listMirrorCharacters();
  assert.deepEqual(list.map(item => item.name), ['指定角色二', '指定角色一']);
  assert(list.every(item => item.source === 'CONFIGURED'));
});

test('名单里的角色全部失效时回退自动选取，而不是给空名单', async () => {
  await setSetting('mirror.featuredCharacterIds', ['no-such-1', 'no-such-2']);
  const list = await listMirrorCharacters();
  assert(list.length > 0);
  assert(list.every(item => item.source === 'AUTO'));
});

test('购买次数：开关与定价共同决定有没有购买这个选项', () => {
  const config = {purchaseEnabled: true, purchaseCoins: 30, purchaseDailyCap: 2};
  const buyable = purchasePlanOf(config, false);
  assert.equal(buyable.available, true);
  assert.equal(buyable.coins, 30);
  assert.equal(purchasePlanOf({...config, purchaseEnabled: false}, false).available, false);
  assert.equal(purchasePlanOf({...config, purchaseCoins: 0}, false).available, false);
  // 匿名没有余额也没有长期身份，不给买。
  assert.equal(purchasePlanOf(config, true).available, false);
  assert.equal(purchaseBlockedReason(purchasePlanOf({...config, purchaseEnabled: false}, false), 'CHARGE'), '今天的次数已用完，购买次数尚未开放，明天再来。');
  assert.equal(purchaseBlockedReason(purchasePlanOf(config, false), 'CHARGE', true), '今天的次数和购买次数都用完了，明天再来。');
  assert.equal(purchaseBlockedReason(purchasePlanOf(config, false), 'PAUSE'), '今天的次数已用完，购买次数尚未开放，明天再来。');
});

test('购买次数：今日已购按业务日统计，跨日与其他操作不计入', async () => {
  const user = await db.user.create({data: {username: 'mirror-buyer', email: 'mirror-buyer@example.invalid', passwordHash: 'synthetic-only'}});
  const now = new Date('2026-03-05T04:00:00.000Z');
  const make = (requestId, operation, status, heldAt) => db.generationCharge.create({
    data: {userId: user.id, requestId, operation, status, coins: 30, priceSnapshotJson: '{}', allowanceSource: 'PAID', heldAt},
  });
  await make('r-today-held', 'MIRROR', 'HELD', new Date('2026-03-05T01:00:00.000Z'));
  await make('r-today-settled', 'MIRROR', 'SETTLED', new Date('2026-03-05T02:00:00.000Z'));
  await make('r-released', 'MIRROR', 'RELEASED', new Date('2026-03-05T03:00:00.000Z'));
  await make('r-other-op', 'CHAT_SEND', 'SETTLED', new Date('2026-03-05T03:30:00.000Z'));
  await make('r-yesterday', 'MIRROR', 'SETTLED', new Date('2026-03-03T20:00:00.000Z'));
  assert.equal(await readPurchasedToday(user.id, 'UTC', now), 2);
  assert.equal(await readPurchasedToday(user.id, 'Asia/Shanghai', now), 2);
});

test('接口层：初始化签发匿名主体 Cookie，且不把 Cookie 内容回给浏览器', async () => {
  const {GET} = await import('../src/app/api/mirror/route.ts');
  resetMirrorLimits();
  const response = await GET(new Request('http://localhost/api/mirror', {headers: {'x-forwarded-for': '198.51.100.77'}}));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal('cookies' in body, false);
  assert.equal(Array.isArray(body.characters), true);
  assert.equal(body.rules.questionCount, 3);
  assert.equal(body.rules.answerMaxChars, 60);
  assert.equal(body.quota.anonymous, true);
  // 匿名两条通道都出现在响应里：Cookie 1 次、IP 10 次。
  assert.equal(body.quota.channels.cookie.limit, 1);
  assert.equal(body.quota.channels.ip.limit, 10);
  const issued = response.headers.get('set-cookie') ?? '';
  assert.match(issued, /xb_mirror_subject=/);
  assert.match(issued, /HttpOnly/i);
  // IP 只以哈希进入计数，响应里不出现来源地址。
  assert.equal(JSON.stringify(body).includes('198.51.100.77'), false);
});

test('接口层：同一 IP 的匿名额度用完后生成返回 429，且不发起模型调用', async () => {
  const {POST} = await import('../src/app/api/mirror/route.ts');
  const {readConfigFor} = await import('../src/lib/mirror/config.ts');
  resetMirrorLimits();
  // 匿名入口要先有匿名预算才开放（AI 成本闸门），这里给足预算，专心测额度通道。
  await setSetting('budget.task.mirrorAnonymous', 100, 'billing');
  const character = await db.character.create({data: {name: '额度角色', personality: 'x', background: 'y', isPublic: true, reviewStatus: 'APPROVED'}});
  const config = await readConfigFor(null);
  const day = mirrorDayKey(new Date(), config.timezone);
  const ipHash = hashMirrorIp('203.0.113.55', process.env.MIRROR_IP_SALT);
  // 另一个浏览器（不同 Cookie 主体）已经把同一 IP 的 10 次用完。
  const planNow = {userLimit: config.userDailyLimit, cookieLimit: config.anonymousDailyLimit, ipLimit: config.anonymousIpDailyLimit};
  for (let i = 0; i < planNow.ipLimit; i++) {
    consumeMirrorLimit(identity({userId: null, cookieSubject: `subject-elsewhere-${i.toString().padStart(8, '0')}`, ipHash}), planNow, day);
  }
  const before = await db.aiCall.count({where: {taskType: 'mirror'}});

  const response = await POST(new Request('http://localhost/api/mirror', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.55'},
    body: JSON.stringify({characterId: character.id, answers: ['一', '二', '三']}),
  }));
  assert.equal(response.status, 429);
  assert.equal((await response.json()).code, 'MIRROR_OVER_LIMIT');
  // 额度检查在模型调用之前：没有新增任何 AiCall 记录。
  assert.equal(await db.aiCall.count({where: {taskType: 'mirror'}}), before);
});

test('接口层：生成失败是明确失败态，不写占位结果也不占额度', async () => {
  const {POST} = await import('../src/app/api/mirror/route.ts');
  const {readConfigFor} = await import('../src/lib/mirror/config.ts');
  const {GET: readOne} = await import('../src/app/api/mirror/[shareId]/route.ts');
  resetMirrorLimits();
  await setSetting('budget.task.mirrorAnonymous', 100, 'billing');
  const character = await db.character.create({data: {name: '失败角色', personality: 'x', background: 'y', isPublic: true, reviewStatus: 'APPROVED'}});
  const config = await readConfigFor(null);
  const day = mirrorDayKey(new Date(), config.timezone);
  const resultsBefore = await db.mirrorResult.count();

  // 测试环境没有配置任何 AI 供应商，模型层会明确失败——正是「生成失败」的真实路径。
  const response = await POST(new Request('http://localhost/api/mirror', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.70'},
    body: JSON.stringify({characterId: character.id, answers: ['一', '二', '三']}),
  }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'MIRROR_AI_UNAVAILABLE');
  // 失败态是明确的错误文案，不是一条「看起来成功」的结果。
  assert.equal(typeof body.error, 'string');
  assert.equal('result' in body, false);
  assert.equal('shareId' in body, false);
  // 库里没有新增任何结果行，所以也就不存在一个能打开的分享链接。
  assert.equal(await db.mirrorResult.count(), resultsBefore);
  // 失败的这次不占额度：两条通道都还是 0。
  const ipHash = hashMirrorIp('203.0.113.70', process.env.MIRROR_IP_SALT);
  const usage = readMirrorUsage({userId: null, cookieSubject: null, cookieReportedCount: 0, ipHash}, day);
  assert.equal(usage.ipUsed, 0);
  // 失败的调用仍留下成本痕迹（AiCall 记 FAILED），便于运营核对。
  const calls = await db.aiCall.findMany({where: {taskType: 'mirror'}, select: {status: true}});
  assert(calls.some(call => call.status === 'FAILED'));
  // 访问一个从未签发过的分享 id：404，而不是空壳结果页。
  const missing = await readOne(new Request('http://localhost/api/mirror/share-not-issued'), {params: Promise.resolve({shareId: 'share-not-issued'})});
  assert.equal(missing.status, 404);
  // 清掉这次失败留下的成本记录：成本未知的调用会让后面的预算闸门判为「无法核对」，
  // 那是另一条用例要测的东西，不该串到额度用例里。
  await db.aiCall.deleteMany({where: {taskType: 'mirror'}});
});

test('接口层：IP 通道关掉（上限 0）时匿名生成被拒，文案说「暂停」不说「去买次数」', async () => {
  const {POST} = await import('../src/app/api/mirror/route.ts');
  resetMirrorLimits();
  await setSetting('budget.task.mirrorAnonymous', 100, 'billing');
  await setSetting('mirror.anonymousIpDailyLimit', 0);
  const character = await db.character.create({data: {name: '暂停角色', personality: 'x', background: 'y', isPublic: true, reviewStatus: 'APPROVED'}});
  try {
    const response = await POST(new Request('http://localhost/api/mirror', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.80'},
      body: JSON.stringify({characterId: character.id, answers: ['一', '二', '三']}),
    }));
    assert.equal(response.status, 429);
    const body = await response.json();
    assert.equal(body.code, 'MIRROR_OVER_LIMIT');
    assert.match(body.error, /暂停生成/);
    assert.equal(body.error.includes('购买'), false);
  } finally {
    // 还原，避免影响后面的接口层用例。
    await db.operationSetting.deleteMany({where: {key: 'mirror.anonymousIpDailyLimit'}});
    clearCache();
  }
});

test('接口层：回答题数不对时返回 400，且不消耗额度', async () => {
  const {POST} = await import('../src/app/api/mirror/route.ts');
  const {readConfigFor} = await import('../src/lib/mirror/config.ts');
  resetMirrorLimits();
  const character = await db.character.create({data: {name: '参数角色', personality: 'x', background: 'y', isPublic: true, reviewStatus: 'APPROVED'}});
  const config = await readConfigFor(null);
  const day = mirrorDayKey(new Date(), config.timezone);
  const response = await POST(new Request('http://localhost/api/mirror', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.56'},
    body: JSON.stringify({characterId: character.id, answers: ['只有一题']}),
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'MIRROR_ANSWERS_INVALID');
  const ipHash = hashMirrorIp('203.0.113.56', process.env.MIRROR_IP_SALT);
  assert.equal(readMirrorUsage({userId: null, cookieSubject: null, cookieReportedCount: 0, ipHash}, day).ipUsed, 0);
});

test('接口层：分享接口返回公开视图，mine 只列自己的，compare 未登录 401', async () => {
  const {GET: readOne, DELETE: removeOne} = await import('../src/app/api/mirror/[shareId]/route.ts');
  const {GET: readMine} = await import('../src/app/api/mirror/mine/route.ts');
  const {GET: compare} = await import('../src/app/api/mirror/compare/route.ts');
  const character = await db.character.create({data: {name: '接口角色', personality: 'x', background: 'y', isPublic: true, reviewStatus: 'APPROVED'}});
  const shareId = 'share' + randomUUID().replace(/-/g, '').slice(0, 12);
  await db.mirrorResult.create({data: {shareId, userId: null, anonymousSubject: 'subject-api-0000000001', characterId: character.id, answersJson: JSON.stringify(['原回答一', '原回答二', '原回答三']), title: '称号', observationsJson: JSON.stringify(['a', 'b', 'c']), quote: 'q', indicesJson: JSON.stringify({atmosphere: 50, rapport: 60}), status: 'READY'}});

  const params = {params: Promise.resolve({shareId})};
  const response = await readOne(new Request('http://localhost/api/mirror/' + shareId), params);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.kind, 'public');
  // 陌生人拿到的响应体里没有任何原回答。
  assert.equal(JSON.stringify(body).includes('原回答'), false);

  const mine = await readMine(new Request('http://localhost/api/mirror/mine'));
  assert.equal(mine.status, 200);
  assert.deepEqual((await mine.json()).results, []);

  assert.equal((await compare(new Request('http://localhost/api/mirror/compare?shareId=' + shareId))).status, 401);

  assert.equal((await removeOne(new Request('http://localhost/api/mirror/' + shareId, {method: 'DELETE'}), params)).status, 403);
  assert.equal((await readOne(new Request('http://localhost/api/mirror/' + shareId), params)).status, 200);
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
