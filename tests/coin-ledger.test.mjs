import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = `coin-ledger-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const env = {...process.env};
delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);

const {db} = await import('../src/lib/db.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {readCoinLedger} = await import('../src/lib/coins/ledger-service.ts');
const {grantEarnedCoins, spendCoins} = await import('../src/lib/coins/reward-ledger.ts');
const {GET} = await import('../src/app/api/coins/ledger/route.ts');

const owner = await db.user.create({data: {username: `ledger_owner_${process.pid}`, email: `ledger-owner-${process.pid}@example.invalid`, passwordHash: 'synthetic', coins: 0}});
const other = await db.user.create({data: {username: `ledger_other_${process.pid}`, email: `ledger-other-${process.pid}@example.invalid`, passwordHash: 'synthetic', coins: 0}});
const token = user => signToken({userId: user.id, email: user.email, tokenVersion: user.tokenVersion});
const request = async (user, query = '') => new Request(`http://localhost/api/coins/ledger${query}`, {headers: user ? {Authorization: 'Bearer ' + await token(user)} : {}});

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

test('anonymous callers get 401 and the body keeps the shared error shape', async () => {
  const response = await GET(await request(null));
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.code, 'UNAUTHORIZED');
  assert.match(response.headers.get('cache-control') ?? '', /private, no-store/);
});

test('ledger returns the balance, marks the first purchase and stays per-user', async () => {
  const empty = await GET(await request(owner));
  assert.equal(empty.status, 200);
  const emptyBody = await empty.json();
  assert.equal(emptyBody.balance, 0);
  assert.equal(emptyBody.firstPurchase, true, '没有任何充值入账时应提示首充');
  assert.deepEqual(emptyBody.items, []);

  await db.$transaction(tx => grantEarnedCoins(tx, owner.id, 120, '签到奖励', 'CHECKIN'));
  await db.$transaction(tx => spendCoins(tx, owner.id, 50, '送出礼物', 'GIFT_SENT'));
  await db.coinTransaction.create({data: {userId: owner.id, amount: 600, type: 'PURCHASE', sourceKey: 'PURCHASE', description: '充值 6 元'}});
  await db.user.update({where: {id: owner.id}, data: {coins: {increment: 600}}});
  await db.$transaction(tx => grantEarnedCoins(tx, other.id, 999, '别人的奖励', 'CHECKIN'));

  const page = await (await GET(await request(owner))).json();
  assert.equal(page.balance, 670);
  assert.equal(page.firstPurchase, false, '有充值入账后不再是首充');
  const amounts = page.items.map(item => `${item.type}:${item.amount}`);
  assert(amounts.includes('PURCHASE:600'));
  assert(amounts.includes('EARNED:120'));
  assert(amounts.includes('SPENT:-50'));
  assert.equal(page.items.filter(item => item.amount === 999).length, 0, '不得读到其他用户的流水');
  assert.equal(page.items[0].createdAt.length > 0, true);
});

test('pagination walks backwards with the cursor and never repeats a row', async () => {
  const all = await readCoinLedger(owner.id, {take: 2});
  assert.equal(all.items.length, 2);
  assert.ok(all.nextCursor, '还有数据时应给出游标');

  const next = await readCoinLedger(owner.id, {take: 2, cursor: all.nextCursor});
  const seen = new Set(all.items.map(item => item.id));
  assert(next.items.every(item => !seen.has(item.id)), '下一页不能重复上一页的行');
  assert.equal(next.balance, all.balance);

  const bogus = await readCoinLedger(owner.id, {cursor: '不是合法游标'});
  assert.equal(bogus.items.length > 0, true, '非法游标按第一页处理，不报错');
});
