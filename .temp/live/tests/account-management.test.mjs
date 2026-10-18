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
const {POST: logoutRoute} = await import('../src/app/api/auth/logout/route.ts');
const {GET: readAuthMeRoute} = await import('../src/app/api/auth/me/route.ts');
const {readCommunityWriteRestriction, setCommunityRestriction} = await import('../src/lib/community/restriction-service.ts');
const {POST: submitAppeal, GET: listAppeals} = await import('../src/app/api/community-appeals/route.ts');
const {POST: followCreator}=await import('../src/app/api/creators/[username]/follow/route.ts');
const {moderateCommunityReport, reviewCommunityAppeal} = await import('../src/lib/community/moderation-service.ts');
const {GET: listRoute} = await import('../src/app/api/accounts/management/route.ts');
const {PATCH: changeRoute} = await import('../src/app/api/accounts/management/[id]/route.ts');
const {POST: loginRoute} = await import('../src/app/api/auth/login/route.ts');
const {GET: readProfileRoute, PUT: updateProfileRoute} = await import('../src/app/api/users/me/route.ts');
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
test('authenticated account context delegates its profile projection to the account domain', async () => {
  assert.equal((await readAuthMeRoute(await request(null))).status, 401);
  await db.user.update({where: {id: ordinary.id}, data: {readingMode: true, bannedWords: 'blocked', shortcuts: '[{"key":"hello","value":"hi"}]'}});
  const response = await readAuthMeRoute(await request(ordinary));
  assert.equal(response.status, 200);
  const {user} = await response.json();
  assert.equal(user.id, ordinary.id); assert.equal(user.email, ordinary.email); assert.equal(user.coins, 345);
  assert.equal(user.readingMode, true); assert.equal(user.bannedWords, 'blocked');
  assert(!('passwordHash' in user)); assert(!('tokenVersion' in user));
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
  assert(await readCommunityWriteRestriction(target.id));
  const blockedFollow=await followCreator(new Request('http://localhost/api/creators/community_target/follow',{method:'POST',headers:{Authorization:`Bearer ${before.token}`}}),{params:Promise.resolve({username:target.username})});assert.equal(blockedFollow.status,403);assert.match((await blockedFollow.json()).error,/社区发言权限/);
  assert((await getAuthUser(await request(null, 'GET', undefined, before.token)))?.userId === target.id);
  assert(await loginWithPassword({email: target.email, password}));
  assert.equal((await listManagedAccounts(viewer.id, {q: target.email, community: 'BANNED'})).total, 1);
  assert.equal(await db.moderationAction.count({where: {targetId: target.id, action: 'BAN'}}), 1);
  assert.equal(await db.adminAuditLog.count({where: {targetId: target.id, action: 'ACCOUNT_BAN_COMMUNITY'}}), 1);
  await act(support, target, 'UNBAN_COMMUNITY'); assert.equal(await readCommunityWriteRestriction(target.id), null);
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
test('logout revokes every token version and clears the media session cookie', async () => {
  const account = await fixture('logout_fixture');
  const oldToken = await signToken({userId: account.id, email: account.email, tokenVersion: account.tokenVersion});
  const logout = await logoutRoute(new Request('http://localhost/api/auth/logout', {method: 'POST', headers: {Authorization: `Bearer ${oldToken}`}}));
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie') ?? '', /xingban_media_session=.*Max-Age=0/i);
  const meRequest = token => new Request('http://localhost/api/users/me', {headers: {Authorization: `Bearer ${token}`}});
  assert.equal((await readProfileRoute(meRequest(oldToken))).status, 401);
  const updated = await db.user.findUnique({where: {id: account.id}, select: {tokenVersion: true}});
  const currentToken = await signToken({userId: account.id, email: account.email, tokenVersion: updated.tokenVersion});
  assert.equal((await readProfileRoute(meRequest(currentToken))).status, 200);
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
test('own profile service updates display preferences without exposing credentials or changing balances', async () => {
  const balance = viewer.coins;
  const update = await updateProfileRoute(await request(viewer, 'PUT', {
    username: 'viewer_profile', name: 'Viewer display', bannedWords: 'alpha\nbeta', readingMode: true, shortcuts: {hello: 'hi'},
  }));
  assert.equal(update.status, 200);
  const payload = await update.json();
  assert.equal(payload.user.username, 'viewer_profile');
  assert.equal(payload.user.name, 'Viewer display');
  assert.equal(payload.user.readingMode, true);
  assert.equal(payload.user.coins, balance);
  assert(!('passwordHash' in payload.user));
  assert.equal((await updateProfileRoute(await request(ordinary, 'PUT', {username: 'viewer_profile'}))).status, 409);
  assert.equal((await updateProfileRoute(await request(viewer, 'PUT', {shortcuts: 'not json{'}))).status, 400);
  const profile = await readProfileRoute(await request(viewer));
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).user.bannedWords, 'alpha\nbeta');
});
test('report and appeal workflows share restriction state, optimistic version and transactional authority', async () => {
  const target = await fixture('report_target');
  const report = await db.report.create({data: {reporterId: ordinary.id, targetType: 'USER', targetId: target.id, category: 'OTHER', details: '合成举报'}});
  await moderateCommunityReport(owner.id, report.id, {action: 'BAN', reason: '举报核实'});
  assert.equal((await db.user.findUnique({where: {id: target.id}})).accountVersion, 1);
  await denied(() => moderateCommunityReport(viewer.id, report.id, {action: 'UNBAN', reason: '越权'}), 403);
  const appeal = await db.communityAppeal.create({data: {userId: target.id, reason: '申请复核'}});
  await reviewCommunityAppeal(owner.id, appeal.id, {status: 'ACCEPTED', resolution: '复核通过'});
  assert.equal(await readCommunityWriteRestriction(target.id), null); assert.equal((await db.user.findUnique({where: {id: target.id}})).accountVersion, 2);
  await denied(() => reviewCommunityAppeal(owner.id, appeal.id, {status: 'ACCEPTED', resolution: '重复复核'}), 409);
  assert.equal(await db.moderationAction.count({where: {targetId: appeal.id}}), 1);
});
test('community appeal submission checks restriction and writes one appeal with its audit', async () => {
  const appealRequest = (user, method = 'POST', body) => request(user, method, body);
  const reason = '我认为这次社区限制存在误判，请核对相关帖子和处理记录。';
  assert.equal((await submitAppeal(await appealRequest(ordinary, 'POST', {reason}))).status, 409);
  await db.$transaction(tx => setCommunityRestriction(tx, ordinary.id, true, '隔离测试封禁'));
  const submitted = await submitAppeal(await appealRequest(ordinary, 'POST', {reason}));
  assert.equal(submitted.status, 201);
  assert.equal((await submitAppeal(await appealRequest(ordinary, 'POST', {reason}))).status, 409);
  const rows = await listAppeals(await appealRequest(ordinary));
  assert.equal(rows.status, 200);
  assert.equal((await rows.json()).length, 1);
  assert.equal(await db.moderationAction.count({where: {actorId: ordinary.id, action: 'APPEAL_SUBMITTED'}}), 1);
});

test('server bootstrap refuses a suspended identity before changing owner assignments', async () => {
  const target = await fixture('suspended_bootstrap_target');
  await act(owner, target, 'SUSPEND');
  await denied(() => bootstrapOwner(target.email), 404);
  assert.equal(await db.adminOperator.count({where: {userId: target.id}}), 0);
});
