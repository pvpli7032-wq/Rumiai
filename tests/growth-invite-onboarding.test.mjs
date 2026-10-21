/**
 * 增长：新手引导与邀请（V3 表 9 增长、表 22）。
 *
 * 覆盖：邀请码只生成一次且可复用、邀请码写错不让注册失败、自己不能邀请自己、
 * 引导跳过后不再被拉回、兴趣标签只收白名单、推荐角色只取已审核公开、
 * 邀请奖励只发一次、开关关闭不发币。
 *
 * 用临时 SQLite 库跑真实服务代码，不 mock 数据库。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const file = `growth-invite-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.UPLOADS_DIRECTORY = path.resolve('artifacts', file, 'uploads');
process.env.JWT_SECRET = randomUUID() + randomUUID();
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);

const {db, pragmasReady} = await import('../src/lib/db.ts');
await pragmasReady;
const {ensureInviteCode, resolveInviterId, grantInviteRewardIfDue, readInviteSettings} = await import('../src/lib/growth/invite-service.ts');
const {readOnboarding, saveOnboarding} = await import('../src/lib/growth/onboarding-service.ts');
const {saveGroup} = await import('../src/lib/settings/service.ts');
const {clearCache} = await import('../src/lib/settings/cache.ts');

let seq = 0;
async function makeUser(overrides = {}) {
  seq += 1;
  return db.user.create({
    data: {
      username: `user${seq}`,
      email: `user${seq}@example.test`,
      passwordHash: 'x',
      coins: 0,
      ...overrides,
    },
    select: {id: true, coins: true, inviteCode: true, invitedByUserId: true, onboardedAt: true, interestsJson: true},
  });
}

async function setSetting(key, value, group) {
  clearCache();
  await saveGroup({changes: [{key, value}], expectedVersions: {}, operatorId: 'test-operator', group});
  clearCache();
}

test('邀请码只生成一次，之后重复调用返回同一个码', async () => {
  const user = await makeUser();
  const first = await ensureInviteCode(user.id);
  const second = await ensureInviteCode(user.id);
  assert.equal(first, second, '邀请码必须稳定，否则已发出去的链接会失效');
  assert.equal(first.length, 8);
  assert.match(first, /^[23456789A-HJ-NP-Z]{8}$/, '排除易混字符 0/O/1/I');
});

test('并发取邀请码不会产生两个码', async () => {
  const user = await makeUser();
  const codes = await Promise.all([ensureInviteCode(user.id), ensureInviteCode(user.id), ensureInviteCode(user.id)]);
  assert.equal(new Set(codes).size, 1);
});

test('邀请码能解析出邀请人；自己邀请自己返回 null', async () => {
  const inviter = await makeUser();
  const code = await ensureInviteCode(inviter.id);
  assert.equal(await resolveInviterId(code, 'someone-else'), inviter.id);
  assert.equal(await resolveInviterId(code.toLowerCase(), 'someone-else'), inviter.id, '大小写不敏感');
  assert.equal(await resolveInviterId(code, inviter.id), null, '不能自己邀请自己');
  assert.equal(await resolveInviterId('NOPE0000', 'someone-else'), null, '无效码不报错只当没有');
  assert.equal(await resolveInviterId('', 'someone-else'), null);
  assert.equal(await resolveInviterId(null, 'someone-else'), null);
});

test('已注销的邀请人不记录归属', async () => {
  const inviter = await makeUser({deletedAt: new Date()});
  const code = await ensureInviteCode(inviter.id);
  assert.equal(await resolveInviterId(code, 'someone-else'), null);
});

test('邀请开关关闭时 readInviteSettings 返回 false', async () => {
  clearCache();
  const settings = await readInviteSettings();
  assert.equal(settings.enabled, false);
  assert.equal(settings.rewardCoins, 0);
});

test('邀请奖励：开关关闭不发，开启后只发一次', async () => {
  const inviter = await makeUser({coins: 0});
  const invited = await makeUser({invitedByUserId: inviter.id});

  assert.equal(await grantInviteRewardIfDue(invited.id), false, '开关关闭时不发');
  assert.equal((await db.user.findUnique({where: {id: inviter.id}, select: {coins: true}})).coins, 0);

  await setSetting('growth.inviteEnabled', true, 'growth');
  await setSetting('growth.inviteRewardCoins', 50, 'growth');

  assert.equal(await grantInviteRewardIfDue(invited.id), true);
  const after = await db.user.findUnique({where: {id: inviter.id}, select: {coins: true}});
  assert.equal(after.coins, 50);

  assert.equal(await grantInviteRewardIfDue(invited.id), false, '同一被邀请人只发一次');
  const again = await db.user.findUnique({where: {id: inviter.id}, select: {coins: true}});
  assert.equal(again.coins, 50, '重复调用不能加币');

  const rows = await db.coinTransaction.findMany({where: {userId: inviter.id}, select: {amount: true, rewardKey: true, sourceKey: true}});
  assert.equal(rows.length, 1, '重复调用不能写第二条流水');
  assert.equal(rows[0].amount, 50);
  assert.equal(rows[0].rewardKey, `invite-first-chat:${invited.id}`);
  assert.equal(rows[0].sourceKey, 'INVITE_REWARD');
});

test('没有邀请人的账号不发邀请奖', async () => {
  await setSetting('growth.inviteEnabled', true, 'growth');
  await setSetting('growth.inviteRewardCoins', 50, 'growth');
  const lonely = await makeUser();
  assert.equal(await grantInviteRewardIfDue(lonely.id), false);
});

test('引导：开关关闭时 enabled=false 且不查推荐', async () => {
  const user = await makeUser();
  const view = await readOnboarding(user.id);
  assert.equal(view.enabled, false);
  assert.equal(view.completed, false);
  assert.deepEqual(view.recommended, []);
});

test('引导：跳过后 completed 为真，不再被拉回', async () => {
  const user = await makeUser();
  await setSetting('growth.onboardingEnabled', true, 'growth');
  const before = await readOnboarding(user.id);
  assert.equal(before.enabled, true);
  assert.equal(before.completed, false);

  await saveOnboarding(user.id, {skipped: true});
  const after = await readOnboarding(user.id);
  assert.equal(after.completed, true, '跳过也要写完成时间，否则每次登录都被拉回');
  assert.deepEqual(after.recommended, [], '已完成不再返回推荐');
});

test('引导：兴趣标签只接受白名单里的值', async () => {
  const user = await makeUser();
  await setSetting('growth.onboardingEnabled', true, 'growth');
  await setSetting('growth.interestTags', ['治愈', '悬疑'], 'growth');
  const saved = await saveOnboarding(user.id, {interests: ['治愈', '不存在的标签', '悬疑', 123]});
  assert.deepEqual(saved.interests, ['治愈', '悬疑']);
  const view = await readOnboarding(user.id);
  assert.deepEqual(view.interests, ['治愈', '悬疑']);
  assert.deepEqual(view.interestTags, ['治愈', '悬疑']);
});

test('引导：推荐只取已审核公开角色，且优先命中兴趣标签', async () => {
  const user = await makeUser();
  await setSetting('growth.onboardingEnabled', true, 'growth');
  await setSetting('growth.interestTags', ['治愈'], 'growth');
  const base = {personality: 'p', background: 'b'};
  const hit = await db.character.create({data: {...base, name: '治愈系', isPublic: true, reviewStatus: 'APPROVED', tags: '治愈', chatCount: 1}});
  await db.character.create({data: {...base, name: '高热度', isPublic: true, reviewStatus: 'APPROVED', tags: '悬疑', chatCount: 999}});
  await db.character.create({data: {...base, name: '未审核', isPublic: true, reviewStatus: 'DRAFT', tags: '治愈', chatCount: 999}});
  await db.character.create({data: {...base, name: '非公开', isPublic: false, reviewStatus: 'APPROVED', tags: '治愈', chatCount: 999}});

  await saveOnboarding(user.id, {interests: ['治愈'], skipped: false}).then(() => db.user.update({where: {id: user.id}, data: {onboardedAt: null}}));
  const view = await readOnboarding(user.id);
  const names = view.recommended.map(item => item.name);
  assert.equal(names[0], hit.name, '命中兴趣标签的排在前面');
  assert.ok(!names.includes('未审核'), '未审核角色不能推荐');
  assert.ok(!names.includes('非公开'), '非公开角色不能推荐');
  assert.equal(view.recommended.length, 2);
});
