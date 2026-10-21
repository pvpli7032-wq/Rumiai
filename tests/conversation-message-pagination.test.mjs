import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = `conversation-pagination-${process.pid}-${Date.now()}.db`;
const databasePath = path.resolve('prisma', file);
process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, '/')}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const {createIsolatedDatabase} = await import('../scripts/helpers/create-isolated-db.mjs');
createIsolatedDatabase(databasePath);

const {db} = await import('../src/lib/db.ts');
const {readConversationMessagePage, readConversationMessages, ConversationMessageError} = await import('../src/lib/conversations/message-service.ts');
const {GET: messagesRoute} = await import('../src/app/api/conversations/[id]/messages/route.ts');
const {signToken} = await import('../src/lib/auth.ts');

test.after(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});
});

const user = (name) => db.user.create({data: {username: name, email: `${name}@example.invalid`, passwordHash: 'synthetic-only'}});

/** 建一个会话并写入 count 条消息；每条独立时间戳，模拟正常聊天节奏。 */
async function seed(owner, count, {startAt = new Date('2026-10-21T00:00:00.000Z')} = {}) {
  const character = await db.character.create({data: {creatorId: owner.id, name: '分页测试角色', personality: 'synthetic', background: ''}});
  const conversation = await db.conversation.create({data: {userId: owner.id, characterId: character.id}});
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push(await db.message.create({data: {
      conversationId: conversation.id,
      role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
      content: `第 ${i + 1} 条`,
      createdAt: new Date(startAt.getTime() + i * 1000),
    }}));
  }
  return {conversation, rows};
}

function authHeaders(token) {
  return {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'};
}

test('分页从最新一页往前翻，游标不重复也不漏', async () => {
  const owner = await user('page_owner');
  const {conversation, rows} = await seed(owner, 120);
  const first = await readConversationMessagePage(owner.id, conversation.id, {limit: '50'});
  assert.equal(first.messages.length, 50);
  assert.equal(first.hasMore, true);
  // 最新一页就是尾部 50 条，且页内仍是升序。
  assert.deepEqual(first.messages.map(m => m.id), rows.slice(70).map(r => r.id));

  const second = await readConversationMessagePage(owner.id, conversation.id, {limit: '50', before: first.nextCursor});
  assert.equal(second.messages.length, 50);
  assert.equal(second.hasMore, true);
  assert.deepEqual(second.messages.map(m => m.id), rows.slice(20, 70).map(r => r.id));

  const third = await readConversationMessagePage(owner.id, conversation.id, {limit: '50', before: second.nextCursor});
  assert.equal(third.messages.length, 20);
  assert.equal(third.hasMore, false);
  assert.equal(third.nextCursor, null);
  assert.deepEqual(third.messages.map(m => m.id), rows.slice(0, 20).map(r => r.id));

  // 三页拼起来正好是全部，无重复无遗漏。
  const collected = [...third.messages, ...second.messages, ...first.messages].map(m => m.id);
  assert.deepEqual(collected, rows.map(r => r.id));
});

test('同一毫秒的多条消息靠 id 破并列，翻页不会卡住或重复', async () => {
  const owner = await user('page_tie_owner');
  const character = await db.character.create({data: {creatorId: owner.id, name: '同毫秒角色', personality: 'synthetic', background: ''}});
  const conversation = await db.conversation.create({data: {userId: owner.id, characterId: character.id}});
  const stamp = new Date('2026-10-21T03:00:00.000Z');
  const rows = [];
  for (let i = 0; i < 9; i += 1) {
    rows.push(await db.message.create({data: {conversationId: conversation.id, role: 'USER', content: `同刻 ${i}`, createdAt: stamp}}));
  }
  const ids = rows.map(r => r.id).sort();
  const seen = [];
  let cursor = null;
  for (let guard = 0; guard < 10; guard += 1) {
    const page = await readConversationMessagePage(owner.id, conversation.id, {limit: '4', before: cursor});
    seen.unshift(...page.messages.map(m => m.id));
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }
  assert.deepEqual(seen, ids, '全部同毫秒消息按 id 升序完整取回');
});

test('分页与整段读取的顺序一致', async () => {
  const owner = await user('page_order_owner');
  const {conversation} = await seed(owner, 30);
  const whole = await readConversationMessages(owner.id, conversation.id);
  const paged = [];
  let cursor = null;
  for (let guard = 0; guard < 10; guard += 1) {
    const page = await readConversationMessagePage(owner.id, conversation.id, {limit: '7', before: cursor});
    paged.unshift(...page.messages);
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }
  assert.deepEqual(paged.map(m => m.id), whole.map(m => m.id));
  assert.deepEqual(paged.map(m => m.content), whole.map(m => m.content));
});

test('越权与不存在的会话仍然被拒绝', async () => {
  const owner = await user('page_scope_owner');
  const outsider = await user('page_scope_outsider');
  const {conversation} = await seed(owner, 3);
  await assert.rejects(
    () => readConversationMessagePage(outsider.id, conversation.id, {limit: '10'}),
    (error) => error instanceof ConversationMessageError && error.status === 403,
  );
  await assert.rejects(
    () => readConversationMessagePage(owner.id, 'no-such-conversation', {limit: '10'}),
    (error) => error instanceof ConversationMessageError && error.status === 404,
  );
});

test('非法 limit 与坏游标返回 422，不会静默降级成全量', async () => {
  const owner = await user('page_invalid_owner');
  const {conversation} = await seed(owner, 5);
  for (const limit of ['0', '201', 'abc', '-1', '1.5']) {
    await assert.rejects(
      () => readConversationMessagePage(owner.id, conversation.id, {limit}),
      (error) => error instanceof ConversationMessageError && error.status === 422,
      `limit=${limit} 应当被拒绝`,
    );
  }
  await assert.rejects(
    () => readConversationMessagePage(owner.id, conversation.id, {before: 'not-a-cursor'}),
    (error) => error instanceof ConversationMessageError && error.status === 422,
  );
});

test('路由默认仍返回完整数组，只有显式要分页才换结构', async () => {
  const owner = await user('page_route_owner');
  const {conversation} = await seed(owner, 12);
  const token = await signToken({userId: owner.id, email: owner.email});

  const legacy = await messagesRoute(new Request(`http://localhost/api/conversations/${conversation.id}/messages`, {headers: authHeaders(token)}), {params: Promise.resolve({id: conversation.id})});
  assert.equal(legacy.status, 200);
  const legacyBody = await legacy.json();
  assert.ok(Array.isArray(legacyBody), '旧调用方必须继续拿到数组');
  assert.equal(legacyBody.length, 12);

  const paged = await messagesRoute(new Request(`http://localhost/api/conversations/${conversation.id}/messages?limit=5`, {headers: authHeaders(token)}), {params: Promise.resolve({id: conversation.id})});
  assert.equal(paged.status, 200);
  const pagedBody = await paged.json();
  assert.ok(!Array.isArray(pagedBody), '显式分页必须换成分页结构');
  assert.equal(pagedBody.messages.length, 5);
  assert.equal(pagedBody.hasMore, true);
  assert.equal(typeof pagedBody.nextCursor, 'string');
  // 分页结构里的消息与整段数组的尾部一致。
  assert.deepEqual(pagedBody.messages.map(m => m.id), legacyBody.slice(-5).map(m => m.id));

  const bad = await messagesRoute(new Request(`http://localhost/api/conversations/${conversation.id}/messages?limit=999`, {headers: authHeaders(token)}), {params: Promise.resolve({id: conversation.id})});
  assert.equal(bad.status, 422);
});

test('一万条历史只加载一页，不把整个会话读进内存', async () => {
  const owner = await user('page_long_owner');
  const character = await db.character.create({data: {creatorId: owner.id, name: '长历史角色', personality: 'synthetic', background: ''}});
  const conversation = await db.conversation.create({data: {userId: owner.id, characterId: character.id}});
  // 直接批量插入：走 Prisma 逐条 create 会让这个用例跑几十秒，而它要证明的是读取侧。
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  const rows = [];
  for (let i = 0; i < 10000; i += 1) {
    rows.push({id: `msg_${i.toString().padStart(5, '0')}`, role: i % 2 === 0 ? 'USER' : 'ASSISTANT', content: `第 ${i + 1} 条历史`, at: new Date(base + i * 1000).toISOString()});
  }
  await db.$transaction(rows.map(row => db.message.create({data: {
    id: row.id, conversationId: conversation.id, role: row.role, content: row.content, createdAt: new Date(row.at),
  }})));

  const page = await readConversationMessagePage(owner.id, conversation.id, {limit: '50'});
  assert.equal(page.messages.length, 50, '只返回一页，不是一万条');
  assert.equal(page.hasMore, true);
  // 是尾部 50 条，且顺序为升序。
  assert.equal(page.messages[0].id, 'msg_09950');
  assert.equal(page.messages.at(-1).id, 'msg_09999');
  assert.equal(page.messages[0].content, '第 9951 条历史');

  // 整段读取仍然是一万条——迁移期旧调用方的行为没有被改掉。
  const whole = await readConversationMessages(owner.id, conversation.id);
  assert.equal(whole.length, 10000);
  // 分页结果必须是整段结果的尾部子集，两者顺序口径一致。
  assert.deepEqual(page.messages.map(m => m.id), whole.slice(-50).map(m => m.id));
});
