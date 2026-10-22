import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import path from 'node:path';

/**
 * 后台「财务 · 异常核对」（V3 §8 表 25）。
 *
 * 这一页此前没有任何可视入口，费用单接口虽然存在却没人调用。用例盯三件事：
 * 状态过滤（含多选）、游标分页跨组连续翻页、以及顶部汇总与列表口径一致 ——
 * 汇总若与列表口径不一致，运营看到的「待结算笔数」就是错的，比没有更糟。
 */

const file = `charge-admin-${process.pid}-${Date.now()}.db`;
const database = path.resolve('prisma', file);
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const {createIsolatedDatabase} = await import('../scripts/helpers/create-isolated-db.mjs');
createIsolatedDatabase(database);
const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {listAdminCharges} = await import('../src/lib/admin/charges-admin.ts');

const user = await db.user.create({
  data: {username: 'charge-admin-user', email: 'charge-admin@example.invalid', passwordHash: 'synthetic-only', displayName: '核对用户'},
});

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(database + suffix, {force: true});
});

/** 造一条费用单；heldAt 越早表示冻结越久。 */
let seq = 0;
function charge(status, coins, extra = {}) {
  seq += 1;
  return db.generationCharge.create({
    data: {
      userId: user.id,
      requestId: `req-${seq}`,
      operation: 'CHAT_SEND',
      status,
      coins,
      priceSnapshotJson: '{}',
      heldAt: new Date(Date.now() - seq * 60_000),
      ...extra,
    },
  });
}

test('状态过滤：默认四种状态全出，单选与多选都只给对应状态', async () => {
  const settled = await charge('SETTLED', 3);
  const released = await charge('RELEASED', 4);
  const held = await charge('HELD', 5);
  const unknown = await charge('UNKNOWN', 6);

  const all = await listAdminCharges({});
  assert.equal(all.items.length, 4, '不带状态时四种状态都要出现');
  assert.deepEqual(all.items.map(item => item.status), ['HELD', 'UNKNOWN', 'SETTLED', 'RELEASED'], 'HELD 与 UNKNOWN 排在最前');

  const onlyHeld = await listAdminCharges({status: 'HELD'});
  assert.deepEqual(onlyHeld.items.map(item => item.id), [held.id]);

  // 异常核对默认同时看「冻结」与「未知」，多选用逗号分隔。
  const pending = await listAdminCharges({status: 'HELD,UNKNOWN'});
  assert.deepEqual(pending.items.map(item => item.id), [held.id, unknown.id]);
  assert.equal(pending.items.some(item => item.id === settled.id || item.id === released.id), false);

  await assert.rejects(() => listAdminCharges({status: 'BOGUS'}), /状态筛选无效/);
  await assert.rejects(() => listAdminCharges({status: 'HELD,BOGUS'}), /状态筛选无效/, '多选里混进未知取值也要拒绝');
});

test('游标分页：跨状态组连续翻页，不重复也不漏', async () => {
  await db.generationCharge.deleteMany({});
  seq = 0;
  const created = [];
  // 交错造：每组的冻结时间互相穿插，才能真正验证「跨组」而不是「同组内排序」。
  for (const status of ['HELD', 'UNKNOWN', 'SETTLED', 'RELEASED']) {
    for (let i = 0; i < 3; i += 1) created.push(await charge(status, 10 + i));
  }

  const seen = [];
  let cursor = null;
  for (let guard = 0; guard < 10; guard += 1) {
    const page = await listAdminCharges({limit: '4', cursor});
    seen.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  assert.equal(seen.length, created.length, '翻完所有页必须覆盖全部费用单');
  assert.equal(new Set(seen.map(item => item.id)).size, created.length, '翻页不能出现重复行');
  assert.deepEqual(
    seen.map(item => item.status),
    ['HELD', 'HELD', 'HELD', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'SETTLED', 'SETTLED', 'SETTLED', 'RELEASED', 'RELEASED', 'RELEASED'],
    'HELD → UNKNOWN → SETTLED → RELEASED 逐组走完',
  );
  await assert.rejects(() => listAdminCharges({cursor: 'bad'}), /分页游标无效/);
});

test('汇总：待结算/未知笔数与币数和列表口径一致，且不受分页影响', async () => {
  await db.generationCharge.deleteMany({});
  seq = 0;
  await charge('HELD', 7);
  await charge('HELD', 11);
  await charge('UNKNOWN', 13);
  await charge('SETTLED', 100);
  await charge('RELEASED', 50);

  // 每页只取 1 条：汇总仍是全量口径，不能只统计当前页。
  const firstPage = await listAdminCharges({limit: '1'});
  assert.equal(firstPage.items.length, 1);
  assert.deepEqual(firstPage.summary, {held: 2, unknown: 1, heldCoins: 18, unknownCoins: 13});

  // 与列表口径核对：把 HELD、UNKNOWN 全部翻出来自己数一遍。
  const rows = [];
  let cursor = null;
  for (let guard = 0; guard < 10; guard += 1) {
    const page = await listAdminCharges({status: 'HELD,UNKNOWN', limit: '2', cursor});
    rows.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  const heldRows = rows.filter(item => item.status === 'HELD');
  const unknownRows = rows.filter(item => item.status === 'UNKNOWN');
  assert.equal(firstPage.summary.held, heldRows.length, '待结算笔数必须等于列表里 HELD 的行数');
  assert.equal(firstPage.summary.unknown, unknownRows.length, '未知结果笔数必须等于列表里 UNKNOWN 的行数');
  assert.equal(firstPage.summary.heldCoins, heldRows.reduce((sum, item) => sum + item.coins, 0));
  assert.equal(firstPage.summary.unknownCoins, unknownRows.reduce((sum, item) => sum + item.coins, 0));

  // 每行要带得出关联会话与持有天数：运营靠这两列判断该不该人工介入。
  const withConversation = await charge('HELD', 5, {conversationId: 'conv-fixture-1'});
  const refreshed = await listAdminCharges({status: 'HELD'});
  const row = refreshed.items.find(item => item.id === withConversation.id);
  assert.equal(row.conversationId, 'conv-fixture-1');
  assert.equal(row.userName, '核对用户', '列表要显示可读的用户名而不是 id');
  assert.equal(typeof row.ageMinutes, 'number');
});