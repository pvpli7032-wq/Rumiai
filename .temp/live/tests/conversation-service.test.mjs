import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = `conversation-service-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const migrationEnv = {...process.env}; delete migrationEnv.RUST_LOG;
const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env: migrationEnv, encoding: 'utf8', windowsHide: true});
assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);

const {db} = await import('../src/lib/db.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {createOrReuseConversation, listUserConversations, readConversation, updateConversation, deleteConversation, ConversationError} = await import('../src/lib/conversations/conversation-service.ts');
const {GET: listRoute, POST: createRoute} = await import('../src/app/api/conversations/route.ts');
const {GET: readRoute, PATCH: updateRoute, DELETE: deleteRoute} = await import('../src/app/api/conversations/[id]/route.ts');
const {GET: exportRoute} = await import('../src/app/api/conversations/[id]/export/route.ts');
test.after(async () => {await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});});

const user = name => db.user.create({data: {username: name, email: `${name}@example.invalid`, passwordHash: 'synthetic-only'}});
const character = (creatorId, name, publicRole = false) => db.character.create({data: {
  creatorId, name, personality: 'synthetic', background: '', isPublic: publicRole,
  reviewStatus: publicRole ? 'APPROVED' : 'DRAFT', avatarUrl: '/brand/icon.svg',
}});

test('conversation creation, reuse, new-chat count and ownership are consistent', async () => {
  const owner = await user('conversation_owner');
  const stranger = await user('conversation_stranger');
  const privateRole = await character(owner.id, '私有角色');
  await assert.rejects(() => createOrReuseConversation(stranger.id, {characterId: privateRole.id}), error => error instanceof ConversationError && error.status === 403);

  const first = await createOrReuseConversation(owner.id, {characterId: privateRole.id});
  const reused = await createOrReuseConversation(owner.id, {character_id: privateRole.id});
  const second = await createOrReuseConversation(owner.id, {characterId: privateRole.id, new_chat: true});
  assert.equal(reused.conversation.id, first.conversation.id);
  assert.notEqual(second.conversation.id, first.conversation.id);
  assert.equal(await db.character.findUnique({where: {id: privateRole.id}, select: {chatCount: true}}).then(row => row.chatCount), 2);

  await assert.rejects(() => readConversation(stranger.id, first.conversation.id), error => error.status === 403);
  const changed = await updateConversation(owner.id, first.conversation.id, {notes: '角色笔记', title: '自定义标题', romance: -30, intimacy: 2_000_000, archived: true, relationship_mode: false, ai_model: null});
  assert.equal(changed.conversation.notes, '角色笔记');
  assert.equal(changed.conversation.title, '自定义标题');
  assert.equal(changed.conversation.romance, 0);
  assert.equal(changed.conversation.intimacy, 1_000_000);
  assert.equal(changed.conversation.relationshipMode, false);
  assert.equal((await listUserConversations(owner.id)).length, 1);
  assert.equal((await listUserConversations(owner.id, {archived: true})).length, 1);
  await assert.rejects(() => updateConversation(owner.id, first.conversation.id, {aiModel: 'not-configured-model'}), error => error.status === 400);
  await assert.rejects(() => deleteConversation(stranger.id, first.conversation.id), error => error.status === 403);

  const token = await signToken({userId: owner.id, email: owner.email});
  const request = (url, method = 'GET', body) => new Request(url, {method, headers: {Authorization: `Bearer ${token}`, ...(body ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
  assert.equal((await readRoute(request('http://local.test/api/conversations/' + first.conversation.id), {params: Promise.resolve({id: first.conversation.id})})).status, 200);
  const patched = await updateRoute(request('http://local.test/api/conversations/' + first.conversation.id, 'PATCH', {notes: '经 HTTP 更新'}), {params: Promise.resolve({id: first.conversation.id})});
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).conversation.notes, '经 HTTP 更新');
  assert.equal((await deleteRoute(request('http://local.test/api/conversations/' + first.conversation.id, 'DELETE'), {params: Promise.resolve({id: first.conversation.id})})).status, 200);
});

test('conversation HTTP adapter returns own chats and masks characters after they become private', async () => {
  const owner = await user('conversation_http_owner');
  const reader = await user('conversation_http_reader');
  const role = await character(owner.id, '公开角色', true);
  const ownerToken = await signToken({userId: owner.id, email: owner.email});
  const readerToken = await signToken({userId: reader.id, email: reader.email});
  const post = (token, body) => createRoute(new Request('http://local.test/api/conversations', {
    method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body),
  }));

  assert.equal((await post(ownerToken, {characterId: role.id})).status, 201);
  const first = await post(readerToken, {characterId: role.id});
  assert.equal(first.status, 201);
  const firstId = (await first.json()).conversation.id;
  const reused = await post(readerToken, {characterId: role.id});
  assert.equal((await reused.json()).conversation.id, firstId);
  const fresh = await post(readerToken, {characterId: role.id, newChat: true});
  assert.notEqual((await fresh.json()).conversation.id, firstId);

  await db.character.update({where: {id: role.id}, data: {isPublic: false, reviewStatus: 'DRAFT'}});
  await assert.rejects(() => readConversation(reader.id, firstId), error => error.status === 403);
  const mine = await listRoute(new Request('http://local.test/api/conversations', {headers: {Authorization: `Bearer ${readerToken}`}}));
  const items = await mine.json();
  assert.equal(mine.status, 200);
  assert(items.every(item => item.character.name === '暂不可用的角色' && item.character.avatarUrl === null));
  assert.equal((await listRoute(new Request('http://local.test/api/conversations', {headers: {Authorization: `Bearer ${ownerToken}`}}))).status, 200);
  assert.deepEqual((await listUserConversations(owner.id, {characterId: role.id})).map(item => item.character.name), ['公开角色']);
  await db.message.create({data: {conversationId: firstId, role: 'USER', content: '我的历史记录'}});
  const exported = await exportRoute(new Request(`http://local.test/api/conversations/${firstId}/export`, {headers: {Authorization: `Bearer ${readerToken}`}}), {params: Promise.resolve({id: firstId})});
  assert.equal(exported.status, 200); assert.match(exported.headers.get('cache-control'), /private, no-store/);
  const archive = await exported.json();
  assert.equal(archive.conversation.character.name, '暂不可用的角色');
  assert.equal(archive.messages[0].content, '我的历史记录');
  assert.equal((await exportRoute(new Request(`http://local.test/api/conversations/${firstId}/export`, {headers: {Authorization: `Bearer ${ownerToken}`}}), {params: Promise.resolve({id: firstId})})).status, 403);
});
