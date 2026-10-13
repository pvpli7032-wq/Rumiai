import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const file = `account-management-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.UPLOADS_DIRECTORY = path.resolve('artifacts', 'account-management', file, 'uploads');
process.env.MODERATOR_USER_IDS = ''; process.env.PAYMENT_ADMIN_USER_IDS = '';
const env = {...process.env}; delete env.RUST_LOG;
const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {bootstrapOwner, saveOperator, saveRole} = await import('../src/lib/admin/management-service.ts');
const {listManagedAccounts, readManagedAccount, updateManagedAccount} = await import('../src/lib/accounts/management-service.ts');
const {loginWithPassword} = await import('../src/lib/accounts/login-service.ts');
const {signToken, getAuthUser} = await import('../src/lib/auth.ts');
const {communityWriteBlock} = await import('../src/lib/community-moderation.ts');
const {moderateCommunityReport, reviewCommunityAppeal} = await import('../src/lib/community/moderation-service.ts');
const {GET: listRoute} = await import('../src/app/api/accounts/management/route.ts');
const {PATCH: changeRoute} = await import('../src/app/api/accounts/management/[id]/route.ts');
const {POST: loginRoute} = await import('../src/app/api/auth/login/route.ts');
const password = `LocalOnly!${randomUUID()}`, hash = await bcrypt.hash(password, 10);
const fixture = async name => db.user.create({data: {username: name, email: `${name}@example.invalid`, passwordHash: hash, coins: 345}});
const owner = await fixture('owner'), support = await fixture('support'), viewer = await fixture('viewer'), supervisor = await fixture('supervisor'), ordinary = await fixture('ordinary');
await bootstrapOwner(owner.email);
const supportRole = await db.adminRole.findUnique({where: {code: 'SUPPORT_AGENT'}});
const ownerRole = await db.adminRole.findUnique({where: {code: 'OWNER'}});
await saveOperator(owner.id, {userId: support.id, enabled: true, roleIds: [supportRole.id], version: 0, reason: '客服权限验收'});
const readRole = await saveRole(owner.id, {name: '只读用户查看', permissions: ['accounts.read'], reason: '合成角色'});
await saveOperator(owner.id, {userId: viewer.id, enabled: true, roleIds: [readRole.id], version: 0, reason: '只读验收'});
const manageRole = await saveRole(owner.id, {name: '用户状态主管', permissions: ['accounts.read', 'accounts.manage', 'accounts.sessions.revoke'], reason: '合成角色'});
await saveOperator(owner.id, {userId: supervisor.id, enabled: true, roleIds: [manageRole.id], version: 0, reason: '主管验收'});
const request = async (user, method = 'GET', body, token) => new Request('http://localhost/api/accounts/management', {method, headers: {'Content-Type': 'application/json', ...(user || token ? {Authorization: `Bearer ${token ?? await signToken({userId: user.id, email: user.email, tokenVersion: (await db.user.findUnique({where: {id: user.id}})).tokenVersion})}`} : {})}, ...(body !== undefined ? {body: JSON.stringify(body)} : {})});
const act = async (actor, user, action, reason = '合成操作') => updateManagedAccount(actor.id, user.id, {action, reason, version: (await db.user.findUnique({where: {id: user.id}})).accountVersion});
const denied = (fn, status) => assert.rejects(fn, error => error.status === status);
test.after(async () => {await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});});

test('user management transport rejects anonymous/ordinary callers and private responses exclude credentials', async () => {
  assert.equal((await listRoute(await request())).status, 401);
  assert.equal((await listRoute(await request(ordinary))).status, 403);
  const response = await listRoute(await request(viewer)); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private, no-store/);
  const data = await response.json(); assert(!JSON.stringify(data).includes(hash)); assert(!JSON.stringify(data).includes('tokenVersion'));
});
test('search, state filters, stable pagination and validation work on stored accounts', async () => {
  for (let i = 0; i < 26; i++) await fixture(`paged_${String(i).padStart(2, '0')}`);
  const first = await listManagedAccounts(viewer.id, {q: 'paged_', page: 1}), second = await listManagedAccounts(viewer.id, {q: 'paged_', page: 2});
  assert.equal(first.total, 26); assert.equal(first.items.length, 25); assert.equal(second.items.length, 1); assert(!first.items.some(item => item.id === second.items[0].id));
  assert.equal((await listManagedAccounts(viewer.id, {q: ordinary.id})).total, 1);
  for (const params of [{page: NaN}, {page: 0}, {status: 'BROKEN'}, {community: 'BROKEN'}, {sort: 'BROKEN'}, {q: 'x'.repeat(101)}]) await denied(() => listManagedAccounts(viewer.id, params), 400);
});
test('viewer and support permissions do not permit site suspension or session revocation', async () => {
  for (const actor of [viewer, support]) {
    const response = await changeRoute(await request(actor, 'PATCH', {action: 'SUSPEND', version: 0, reason: '越权'}), {params: Promise.resolve({id: ordinary.id})}); assert.equal(response.status, 403);
    await denied(() => act(actor, ordinary, 'REVOKE_SESSIONS'), 403);
  }
});
test('community restrictions preserve login and appeals, and produce shared moderation and admin audits', async () => {
  const target = await fixture('community_target');
  const before = await loginWithPassword({email: target.email, password});
  await act(support, target, 'BAN_COMMUNITY', '客服社区限制');
  assert.equal((await communityWriteBlock(target.id)).status, 403);
  assert((await getAuthUser(await request(null, 'GET', undefined, before.token)))?.userId === target.id);
  assert(await loginWithPassword({email: target.email, password}));
  assert.equal((await listManagedAccounts(viewer.id, {q: target.email, community: 'BANNED'})).total, 1);
  assert.equal(await db.moderationAction.count({where: {targetId: target.id, action: 'BAN'}}), 1);
  assert.equal(await db.adminAuditLog.count({where: {targetId: target.id, action: 'ACCOUNT_BAN_COMMUNITY'}}), 1);
  await act(support, target, 'UNBAN_COMMUNITY'); assert.equal(await communityWriteBlock(target.id), null);
});
test('site suspension rejects existing tokens and password login, restoration requires fresh login and preserves money', async () => {
  const target = await fixture('site_target');
  const transaction = await db.coinTransaction.create({data: {userId: target.id, type: 'CHECKIN', amount: 3}});
  const order = await db.paymentOrder.create({data: {orderNo: `MOCK${Date.now()}`, idempotencyKey: randomUUID(), userId: target.id, packageCoins: 60, packageBonus: 0, coinAmount: 60, amountCnyCents: 600, status: 'UNKNOWN'}});
  const before = await loginWithPassword({email: target.email, password});
  await act(supervisor, target, 'SUSPEND', '临时安全停用');
  assert.equal(await getAuthUser(await request(null, 'GET', undefined, before.token)), null);
  const login = await loginRoute(new Request('http://localhost/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email: target.email, password})})); assert.equal(login.status, 403);
  assert.equal((await listManagedAccounts(viewer.id, {q: target.email, status: 'SUSPENDED'})).total, 1);
  await act(supervisor, target, 'RESTORE');
  assert.equal(await getAuthUser(await request(null, 'GET', undefined, before.token)), null);
  assert((await loginWithPassword({email: target.email, password})).token);
  assert.equal((await db.user.findUnique({where: {id: target.id}})).coins, 345);
  assert.deepEqual(await db.coinTransaction.findUnique({where: {id: transaction.id}}), transaction);
  assert.deepEqual(await db.paymentOrder.findUnique({where: {id: order.id}}), order);
});
test('session revocation invalidates old sessions while normal credentials remain usable', async () => {
  const target = await fixture('sessions_target'), before = await loginWithPassword({email: target.email, password});
  await act(supervisor, target, 'REVOKE_SESSIONS');
  assert.equal(await getAuthUser(await request(null, 'GET', undefined, before.token)), null);
  assert((await loginWithPassword({email: target.email, password})).token);
});
test('read-only details expose necessary links, not private conversations, persona, provider keys or ledger', async () => {
  const role = await db.character.create({data: {creatorId: ordinary.id, name: '私有角色摘要', personality: 'PRIVATE_PERSONA', background: 'PRIVATE_BACKGROUND', reviewStatus: 'DRAFT'}});
  await db.conversation.create({data: {userId: ordinary.id, characterId: role.id, messages: {create: {role: 'USER', content: 'PRIVATE_CHAT'}}}});
  await db.coinTransaction.create({data: {userId: ordinary.id, type: 'CHECKIN', amount: 1}});
  const detail = await readManagedAccount(support.id, ordinary.id);
  assert.equal(detail.user._count.conversations, 1); assert.equal(detail.characters.length, 1); assert.equal(detail.ledger, null);
  for (const secret of ['PRIVATE_PERSONA', 'PRIVATE_BACKGROUND', 'PRIVATE_CHAT', 'passwordHash', 'tokenVersion']) assert(!JSON.stringify(detail).includes(secret));
  assert.equal((await readManagedAccount(owner.id, ordinary.id)).ledger.length, 1);
});
test('stale and invalid writes have no audit or state side effects', async () => {
  const target = await fixture('conflict_target'), before = await db.adminAuditLog.count();
  await act(owner, target, 'BAN_COMMUNITY');
  await denied(() => updateManagedAccount(owner.id, target.id, {action: 'SUSPEND', version: 0, reason: '过期快照'}), 409);
  for (const input of [null, [], {action: 'toString', version: 1, reason: '非法'}, {action: 'RESTORE', version: 1, reason: ''}]) await denied(() => updateManagedAccount(owner.id, target.id, input), 400);
  assert.equal(await db.adminAuditLog.count(), before + 1); assert.equal((await db.user.findUnique({where: {id: target.id}})).suspendedAt, null);
});
test('two writers on the same account version produce one change and one audit', async () => {
  const target = await fixture('concurrent_target');
  const results = await Promise.allSettled(['BAN_COMMUNITY', 'SUSPEND'].map(action => updateManagedAccount(owner.id, target.id, {action, version: 0, reason: '并发状态修改'})));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
  assert.equal(await db.adminAuditLog.count({where: {targetId: target.id}}), 1);
});
test('administrator state is owner-only, including restoration of suspended legacy administrators', async () => {
  await denied(() => act(supervisor, support, 'SUSPEND'), 403);
  await denied(() => act(supervisor, support, 'REVOKE_SESSIONS'), 403);
  const legacy = await fixture('legacy_admin'); process.env.MODERATOR_USER_IDS = legacy.id;
  await act(owner, legacy, 'SUSPEND');
  await denied(() => act(supervisor, legacy, 'RESTORE'), 403);
  await act(owner, legacy, 'RESTORE'); process.env.MODERATOR_USER_IDS = '';
});
test('last effective owner and self suspension are rejected; an inactive owner is not a safety substitute', async () => {
  await denied(() => act(owner, owner, 'SUSPEND'), 409);
  const second = await fixture('second_owner');
  await saveOperator(owner.id, {userId: second.id, enabled: true, roleIds: [ownerRole.id], version: 0, reason: '第二所有者'});
  await act(owner, second, 'SUSPEND');
  await denied(() => act(owner, owner, 'SUSPEND'), 409);
  await act(owner, second, 'RESTORE');
  await denied(() => act(owner, owner, 'SUSPEND'), 409);
});
test('closed users cannot be resumed and authenticated activity is recorded without writing on every request', async () => {
  const closed = await fixture('closed_target'); await db.user.update({where: {id: closed.id}, data: {deletedAt: new Date()}});
  await denied(() => act(owner, closed, 'RESTORE'), 404);
  assert.equal((await listManagedAccounts(viewer.id, {q: closed.id, status: 'CLOSED'})).total, 1);
  const target = await fixture('activity_target'), token = await signToken({userId: target.id, email: target.email});
  await getAuthUser(await request(null, 'GET', undefined, token)); const first = await db.user.findUnique({where: {id: target.id}});
  await getAuthUser(await request(null, 'GET', undefined, token)); const second = await db.user.findUnique({where: {id: target.id}});
  assert(first.lastActiveAt); assert.equal(first.lastActiveAt.getTime(), second.lastActiveAt.getTime());
});
test('report and appeal workflows share restriction state, optimistic version and transactional authority', async () => {
  const target = await fixture('report_target');
  const report = await db.report.create({data: {reporterId: ordinary.id, targetType: 'USER', targetId: target.id, category: 'OTHER', details: '合成举报'}});
  await moderateCommunityReport(owner.id, report.id, {action: 'BAN', reason: '举报核实'});
  assert.equal((await db.user.findUnique({where: {id: target.id}})).accountVersion, 1);
  await denied(() => moderateCommunityReport(viewer.id, report.id, {action: 'UNBAN', reason: '越权'}), 403);
  const appeal = await db.communityAppeal.create({data: {userId: target.id, reason: '申请复核'}});
  await reviewCommunityAppeal(owner.id, appeal.id, {status: 'ACCEPTED', resolution: '复核通过'});
  assert.equal(await communityWriteBlock(target.id), null); assert.equal((await db.user.findUnique({where: {id: target.id}})).accountVersion, 2);
  await denied(() => reviewCommunityAppeal(owner.id, appeal.id, {status: 'ACCEPTED', resolution: '重复复核'}), 409);
  assert.equal(await db.moderationAction.count({where: {targetId: appeal.id}}), 1);
});

test('server bootstrap refuses a suspended identity before changing owner assignments', async () => {
  const target = await fixture('suspended_bootstrap_target');
  await act(owner, target, 'SUSPEND');
  await denied(() => bootstrapOwner(target.email), 404);
  assert.equal(await db.adminOperator.count({where: {userId: target.id}}), 0);
});
