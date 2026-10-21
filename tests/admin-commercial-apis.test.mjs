import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

/**
 * 后台商业读取接口（Mirror 结果 / 评理案例 / 后台任务 / 模型币价 / 费用单）。
 *
 * 覆盖：未登录 401、无权限 403、游标分页连续、费用单 HELD 优先、币价新增版本后旧版本仍可读。
 * 全部走真实路由处理器与隔离数据库，不 mock 业务层。
 */

const file = `admin-commercial-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);

const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {bootstrapOwner, saveOperator, saveRole} = await import('../src/lib/admin/management-service.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {GET: mirrorList} = await import('../src/app/api/admin/mirror/results/route.ts');
const {DELETE: mirrorHide} = await import('../src/app/api/admin/mirror/results/[id]/route.ts');
const {GET: disputeList} = await import('../src/app/api/admin/disputes/cases/route.ts');
const {POST: disputeClose} = await import('../src/app/api/admin/disputes/cases/[id]/close/route.ts');
const {POST: disputeHide} = await import('../src/app/api/admin/disputes/cases/[id]/hide/route.ts');
const {GET: taskList} = await import('../src/app/api/admin/tasks/route.ts');
const {POST: taskRun} = await import('../src/app/api/admin/tasks/[id]/run/route.ts');
const {GET: coinPriceList, POST: coinPriceCreate} = await import('../src/app/api/admin/ai/coin-prices/route.ts');
const {GET: chargeList} = await import('../src/app/api/admin/billing/charges/route.ts');

const owner = await db.user.create({data: {username: 'ops_owner', email: 'ops-owner@example.invalid', passwordHash: 'synthetic-only'}});
const reader = await db.user.create({data: {username: 'ops_reader', email: 'ops-reader@example.invalid', passwordHash: 'synthetic-only'}});
const nobody = await db.user.create({data: {username: 'ops_nobody', email: 'ops-nobody@example.invalid', passwordHash: 'synthetic-only'}});
const author = await db.user.create({data: {username: 'ops_author', email: 'ops-author@example.invalid', passwordHash: 'synthetic-only', displayName: '发起人'}});

const tokens = new Map();
for (const user of [owner, reader, nobody, author]) tokens.set(user.id, await signToken({userId: user.id, email: user.email, tokenVersion: user.tokenVersion}));
const req = (user, url, init = {}) => new Request(`http://localhost${url}`, {
  ...init,
  headers: {
    ...(user ? {Authorization: `Bearer ${tokens.get(user.id)}`} : {}),
    ...(init.body ? {'Content-Type': 'application/json'} : {}),
    ...(init.headers ?? {}),
  },
});
const ctx = id => ({params: Promise.resolve({id})});
const assignment = async (user, roleIds) => saveOperator(owner.id, {
  userId: user.id, roleIds, enabled: true,
  version: (await db.adminOperator.findUnique({where: {userId: user.id}}))?.version ?? 0,
  reason: '合成后台接口验收',
});

let character, model;
test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

test('匿名与无权限调用一律被拒绝', async () => {
  await bootstrapOwner(owner.email);
  const routes = [
    ['/api/admin/mirror/results', () => mirrorList(req(null, '/api/admin/mirror/results'))],
    ['/api/admin/disputes/cases', () => disputeList(req(null, '/api/admin/disputes/cases'))],
    ['/api/admin/disputes/cases/x/hide', () => disputeHide(req(null, '/api/admin/disputes/cases/x/hide', {method: 'POST', body: JSON.stringify({reason: '合成原因'})}), ctx('x'))],
    ['/api/admin/tasks', () => taskList(req(null, '/api/admin/tasks'))],
    ['/api/admin/ai/coin-prices', () => coinPriceList(req(null, '/api/admin/ai/coin-prices'))],
    ['/api/admin/billing/charges?status=HELD', () => chargeList(req(null, '/api/admin/billing/charges?status=HELD'))],
  ];
  for (const [name, call] of routes) {
    const response = await call();
    assert.equal(response.status, 401, `${name} 未登录应为 401`);
    assert.match(response.headers.get('cache-control'), /private, no-store/);
    assert.deepEqual(Object.keys(await response.json()).sort(), ['code', 'error']);
  }
  // 已登录但没有任何管理权限：403，不是 401。
  const signedIn = [
    () => mirrorList(req(nobody, '/api/admin/mirror/results')),
    () => disputeList(req(nobody, '/api/admin/disputes/cases')),
    () => disputeHide(req(nobody, '/api/admin/disputes/cases/x/hide', {method: 'POST', body: JSON.stringify({reason: '合成原因'})}), ctx('x')),
    () => taskList(req(nobody, '/api/admin/tasks')),
    () => coinPriceList(req(nobody, '/api/admin/ai/coin-prices')),
    () => chargeList(req(nobody, '/api/admin/billing/charges')),
  ];
  for (const call of signedIn) assert.equal((await call()).status, 403);
});

test('只读角色能看列表但不能执行写操作', async () => {
  const readOnly = await saveRole(owner.id, {
    name: '商业只读验收',
    permissions: ['mirror.read', 'disputes.read', 'tasks.read', 'ai.costs.read', 'billing.read'],
    reason: '合成只读角色',
  });
  await assignment(reader, [readOnly.id]);
  assert.equal((await mirrorList(req(reader, '/api/admin/mirror/results'))).status, 200);
  assert.equal((await disputeList(req(reader, '/api/admin/disputes/cases'))).status, 200);
  assert.equal((await taskList(req(reader, '/api/admin/tasks'))).status, 200);
  assert.equal((await coinPriceList(req(reader, '/api/admin/ai/coin-prices'))).status, 200);
  assert.equal((await chargeList(req(reader, '/api/admin/billing/charges'))).status, 200);
  // 写操作全部 403：隐藏、结案、手动跑任务、新增币价。
  const denied = [
    () => mirrorHide(req(reader, '/api/admin/mirror/results/x', {method: 'DELETE'}), ctx('x')),
    () => disputeClose(req(reader, '/api/admin/disputes/cases/x/close', {method: 'POST'}), ctx('x')),
    () => disputeHide(req(reader, '/api/admin/disputes/cases/x/hide', {method: 'POST', body: JSON.stringify({reason: '合成原因'})}), ctx('x')),
    () => taskRun(req(reader, '/api/admin/tasks/memory-summary/run', {method: 'POST'}), ctx('memory-summary')),
    () => coinPriceCreate(req(reader, '/api/admin/ai/coin-prices', {method: 'POST', body: JSON.stringify({modelId: 'x', coinsPerReply: 1})})),
  ];
  for (const call of denied) assert.equal((await call()).status, 403);
});

test('Mirror 结果按游标连续翻页，隐藏后状态变 HIDDEN 且不可重复隐藏', async () => {
  character = await db.character.create({data: {name: '接口验收角色', personality: '温和', background: '合成背景'}});
  for (let i = 0; i < 5; i += 1) {
    await db.mirrorResult.create({data: {
      shareId: `share-${i}`, userId: author.id, characterId: character.id,
      answersJson: '[]', title: `称号 ${i}`, observationsJson: '[]', quote: `金句 ${i}`, indicesJson: '{}',
    }});
  }
  const first = await (await mirrorList(req(owner, '/api/admin/mirror/results?limit=2'))).json();
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor, '第一页必须给出游标');
  assert.equal(first.items[0].author.name, '发起人');
  assert.equal(first.items[0].character.name, '接口验收角色');
  const second = await (await mirrorList(req(owner, `/api/admin/mirror/results?limit=2&cursor=${first.nextCursor}`))).json();
  assert.equal(second.items.length, 2);
  const ids = new Set([...first.items, ...second.items].map(item => item.id));
  assert.equal(ids.size, 4, '两页之间不能重复同一条');
  // 状态筛选与非法参数
  assert.equal((await (await mirrorList(req(owner, '/api/admin/mirror/results?status=READY'))).json()).items.length, 5);
  assert.equal((await mirrorList(req(owner, '/api/admin/mirror/results?status=NOPE'))).status, 400);
  assert.equal((await mirrorList(req(owner, '/api/admin/mirror/results?cursor=%%%'))).status, 400);
  // 隐藏
  const target = first.items[0].id;
  const hidden = await (await mirrorHide(req(owner, `/api/admin/mirror/results/${target}`, {method: 'DELETE'}), ctx(target))).json();
  assert.deepEqual(hidden, {id: target, shareId: hidden.shareId, status: 'HIDDEN', changed: true});
  const again = await (await mirrorHide(req(owner, `/api/admin/mirror/results/${target}`, {method: 'DELETE'}), ctx(target))).json();
  assert.equal(again.changed, false, '重复隐藏应为幂等');
  assert.equal((await mirrorHide(req(owner, '/api/admin/mirror/results/missing', {method: 'DELETE'}), ctx('missing'))).status, 404);
});

test('评理案例列表带出最近失败原因，立即结案写兜底判词', async () => {
  const open = await db.disputeCase.create({data: {
    postId: 'post-open', authorId: author.id, characterId: character.id, excerptJson: '[]', claim: '谁更有理',
    ruleSnapshotJson: JSON.stringify({maxVoteChanges: 1, verdictMaxChars: 120, closeAtVotes: 200, closeAfterHours: 48}),
    deadlineAt: new Date(Date.now() + 3600_000), voteCount: 3,
  }});
  await db.disputeCase.create({data: {
    postId: 'post-closed', authorId: author.id, characterId: character.id, excerptJson: '[]', claim: '已经结束',
    ruleSnapshotJson: '{}', closeStatus: 'CLOSED', deadlineAt: new Date(Date.now() - 3600_000), closedAt: new Date(),
  }});
  await db.backgroundTask.create({data: {kind: 'dispute-close', subjectId: open.id, status: 'PENDING', lastError: '模型超时'}});
  const page = await (await disputeList(req(owner, '/api/admin/disputes/cases?status=OPEN'))).json();
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, open.id);
  assert.equal(page.items[0].voteCount, 3);
  assert.equal(page.items[0].lastFailure.message, '模型超时');
  assert.equal(page.items[0].lastFailure.attempts, 0);
  assert.equal(page.items[0].overdue, false);
  assert.equal((await disputeList(req(owner, '/api/admin/disputes/cases?status=BOGUS'))).status, 400);
  // 立即结案：模型不可用，落明确的非 AI 兜底，仍然成功结案。
  const closed = await (await disputeClose(req(owner, `/api/admin/disputes/cases/${open.id}/close`, {method: 'POST'}), ctx(open.id))).json();
  assert.equal(closed.caseId, open.id);
  assert.equal(closed.status, 'CLOSED');
  const row = await db.disputeCase.findUnique({where: {id: open.id}, select: {closeStatus: true, verdictJson: true}});
  assert.equal(row.closeStatus, 'CLOSED');
  assert.match(JSON.parse(row.verdictJson).text, /不是 AI/);
  // 再结一次：409，不重复生成。
  assert.equal((await disputeClose(req(owner, `/api/admin/disputes/cases/${open.id}/close`, {method: 'POST'}), ctx(open.id))).status, 409);
  assert.equal((await disputeClose(req(owner, '/api/admin/disputes/cases/missing/close', {method: 'POST'}), ctx('missing'))).status, 404);
});

test('后台隐藏案例：停止公开访问、不再结案，原因与操作人进操作日志', async () => {
  const circle = await db.circle.create({data: {name: '评理广场', description: '合成圈子'}});
  const post = await db.post.create({data: {circleId: circle.id, authorId: author.id, content: '合成案例帖'}});
  const open = await db.disputeCase.create({data: {
    postId: post.id, authorId: author.id, characterId: character.id, excerptJson: '[]', claim: '要隐藏的案例',
    ruleSnapshotJson: JSON.stringify({maxVoteChanges: 1, verdictMaxChars: 120, closeAtVotes: 200, closeAfterHours: 48}),
    deadlineAt: new Date(Date.now() - 60_000),
  }});
  const hide = reason => disputeHide(req(owner, `/api/admin/disputes/cases/${open.id}/hide`, {method: 'POST', body: JSON.stringify({reason})}), ctx(open.id));

  // 缺原因：400，什么都没写。
  assert.equal((await hide('   ')).status, 400);
  assert.equal((await db.disputeCase.findUniqueOrThrow({where: {id: open.id}, select: {closeStatus: true}})).closeStatus, 'OPEN');

  const hidden = await (await hide('含未授权联系方式')).json();
  assert.deepEqual(hidden, {caseId: open.id, hidden: true, alreadyHidden: false});
  assert.equal((await db.disputeCase.findUniqueOrThrow({where: {id: open.id}, select: {closeStatus: true}})).closeStatus, 'WITHDRAWN');
  assert.equal((await db.post.findUniqueOrThrow({where: {id: post.id}, select: {status: true}})).status, 'HIDDEN');
  const audit = await db.adminAuditLog.findFirstOrThrow({where: {action: 'DISPUTE_CASE_HIDDEN', targetId: open.id}});
  assert.equal(audit.actorId, owner.id);
  assert.equal(audit.reason, '含未授权联系方式');

  // 列表把隐藏原因与操作人带出来（后台列表与详情共用同一份数据）。
  const page = await (await disputeList(req(owner, '/api/admin/disputes/cases?status=WITHDRAWN'))).json();
  const item = page.items.find(row => row.id === open.id);
  assert.equal(item.hidden.reason, '含未授权联系方式');
  assert.equal(item.hidden.actor.name, 'ops_owner');

  // 重复隐藏幂等，但这次后台操作本身也留痕。
  assert.equal((await (await hide('再次确认')).json()).alreadyHidden, true);
  assert.equal(await db.adminAuditLog.count({where: {action: 'DISPUTE_CASE_HIDDEN', targetId: open.id}}), 2);

  // 已结案的不能隐藏；不存在的 404。
  const closedPost = await db.post.create({data: {circleId: circle.id, authorId: author.id, content: '已结案案例帖'}});
  const closed = await db.disputeCase.create({data: {
    postId: closedPost.id, authorId: author.id, excerptJson: '[]', claim: '已经结束', ruleSnapshotJson: '{}',
    closeStatus: 'CLOSED', deadlineAt: new Date(), closedAt: new Date(),
  }});
  assert.equal((await disputeHide(req(owner, `/api/admin/disputes/cases/${closed.id}/hide`, {method: 'POST', body: JSON.stringify({reason: '合成原因'})}), ctx(closed.id))).status, 409);
  assert.equal((await disputeHide(req(owner, '/api/admin/disputes/cases/missing/hide', {method: 'POST', body: JSON.stringify({reason: '合成原因'})}), ctx('missing'))).status, 404);
});

test('后台任务列表给出开关与计数，手动执行只处理到期任务', async () => {
  await db.backgroundTask.create({data: {kind: 'memory-summary', subjectId: 'conv-1', status: 'DONE'}});
  await db.backgroundTask.create({data: {kind: 'memory-summary', subjectId: 'conv-2', status: 'FAILED', attempts: 2, lastError: '模型失败'}});
  const {items} = await (await taskList(req(owner, '/api/admin/tasks'))).json();
  const summary = items.find(item => item.kind === 'memory-summary');
  assert.equal(summary.name, '聊天记忆摘要');
  assert.equal(summary.switchKey, 'memory.enabled');
  assert.equal(summary.done, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.lastError, '模型失败');
  assert.equal(summary.runnable, true);
  const backup = items.find(item => item.kind === 'backup-cleanup');
  // 备份清理现在也有处理器（按 tasks.backupRetention 清旧备份），同样可手动执行。
  assert.equal(backup.runnable, true);
  assert.equal((await taskRun(req(owner, '/api/admin/tasks/nope/run', {method: 'POST'}), ctx('nope'))).status, 404);
  const run = await (await taskRun(req(owner, '/api/admin/tasks/mirror-expire/run', {method: 'POST'}), ctx('mirror-expire'))).json();
  assert.equal(run.kind, 'mirror-expire');
  assert.match(run.detail, /标记过期|没有到期/);
});

test('币价新增版本后旧版本仍可读', async () => {
  const provider = await db.aiProvider.create({data: {name: '接口验收供应商', baseUrl: 'https://example.invalid'}});
  model = await db.aiModel.create({data: {key: 'fixture-model', displayName: '验收模型', modelCode: 'fixture-1', providerId: provider.id}});
  const first = await (await coinPriceCreate(req(owner, '/api/admin/ai/coin-prices', {method: 'POST', body: JSON.stringify({modelId: model.id, coinsPerReply: 5, effectiveAt: '2026-10-01T00:00:00.000Z'})}))).json();
  assert.equal(first.coinsPerReply, 5);
  assert.equal(first.version, 1);
  const second = await (await coinPriceCreate(req(owner, '/api/admin/ai/coin-prices', {method: 'POST', body: JSON.stringify({modelId: model.id, coinsPerReply: 8, effectiveAt: '2026-10-20T00:00:00.000Z'})}))).json();
  assert.equal(second.version, 2);
  const view = await (await coinPriceList(req(owner, '/api/admin/ai/coin-prices'))).json();
  assert.equal(view.models.length, 1);
  const rows = view.items.filter(item => item.modelId === model.id);
  assert.equal(rows.length, 2, '新增版本不能覆盖旧版本');
  assert.deepEqual(rows.map(row => row.coinsPerReply), [8, 5]);
  assert.deepEqual(rows.map(row => row.version), [2, 1]);
  // 重复的生效时间被拒绝
  const duplicate = await coinPriceCreate(req(owner, '/api/admin/ai/coin-prices', {method: 'POST', body: JSON.stringify({modelId: model.id, coinsPerReply: 9, effectiveAt: '2026-10-20T00:00:00.000Z'})}));
  assert.equal(duplicate.status, 409);
  assert.equal((await coinPriceCreate(req(owner, '/api/admin/ai/coin-prices', {method: 'POST', body: JSON.stringify({modelId: model.id, coinsPerReply: -1})}))).status, 400);
  assert.equal((await coinPriceCreate(req(owner, '/api/admin/ai/coin-prices', {method: 'POST', body: JSON.stringify({modelId: 'missing', coinsPerReply: 1})}))).status, 404);
});

test('费用单按 HELD / UNKNOWN 优先排序并可跨组翻页', async () => {
  const operations = ['CHAT_SEND', 'STORY_TURN'];
  const statuses = ['SETTLED', 'HELD', 'RELEASED', 'HELD', 'UNKNOWN', 'SETTLED'];
  for (let i = 0; i < statuses.length; i += 1) {
    await db.generationCharge.create({data: {
      userId: author.id, requestId: `req-${i}`, operation: operations[i % operations.length], status: statuses[i],
      coins: 10 + i, priceSnapshotJson: '{}', heldAt: new Date(Date.now() - i * 60_000),
    }});
  }
  const page = await (await chargeList(req(owner, '/api/admin/billing/charges?limit=3'))).json();
  assert.deepEqual(page.items.map(item => item.status), ['HELD', 'HELD', 'UNKNOWN'], 'HELD 与 UNKNOWN 必须排在前面');
  assert.equal(page.summary.held, 2);
  assert.equal(page.summary.unknown, 1);
  assert.equal(page.summary.heldCoins, 24, 'HELD 是第 2、4 条：11 + 13');
  assert.ok(page.nextCursor);
  const next = await (await chargeList(req(owner, `/api/admin/billing/charges?limit=3&cursor=${page.nextCursor}`))).json();
  const seen = new Set([...page.items, ...next.items].map(item => item.id));
  assert.equal(seen.size, page.items.length + next.items.length, '翻页不能重复');
  assert.deepEqual(next.items.map(item => item.status), ['SETTLED', 'SETTLED', 'RELEASED']);
  assert.equal(next.nextCursor, null);
  // 只筛 HELD 时不给其他状态
  const onlyHeld = await (await chargeList(req(owner, '/api/admin/billing/charges?status=HELD'))).json();
  assert.equal(onlyHeld.items.every(item => item.status === 'HELD'), true);
  assert.equal((await chargeList(req(owner, '/api/admin/billing/charges?status=BOGUS'))).status, 400);
  assert.equal((await chargeList(req(owner, '/api/admin/billing/charges?cursor=bad'))).status, 400);
});
