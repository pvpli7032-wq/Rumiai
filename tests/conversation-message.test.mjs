import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = `conversation-message-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const migrationEnv = {...process.env}; delete migrationEnv.RUST_LOG;
const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env: migrationEnv, encoding: 'utf8', windowsHide: true});
assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);

const {db} = await import('../src/lib/db.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {editUserMessage, deleteMessageAndFollowing, setMessageLiked, createUserMessage, readRecentMessageHistory, readConversationMessages, persistAssistantResponse, prepareMessageRegeneration, replaceMessageReply, ConversationMessageError} = await import('../src/lib/conversations/message-service.ts');
const {PATCH: editRoute} = await import('../src/app/api/conversations/[id]/messages/[messageId]/route.ts');
const {POST: likeRoute} = await import('../src/app/api/conversations/[id]/messages/[messageId]/like/route.ts');
test.after(async () => {await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});});

const user = name => db.user.create({data: {username: name, email: `${name}@example.invalid`, passwordHash: 'synthetic-only'}});

test('editing a user message atomically removes later replies and enforces conversation ownership', async () => {
  const owner = await user('message_owner');
  const outsider = await user('message_outsider');
  const character = await db.character.create({data: {creatorId: owner.id, name: '对话测试角色', personality: 'synthetic', background: ''}});
  const conversation = await db.conversation.create({data: {userId: owner.id, characterId: character.id}});
  const otherConversation = await db.conversation.create({data: {userId: outsider.id, characterId: character.id}});
  const timestamp = new Date('2026-10-14T00:00:00.000Z');
  const prompt = await db.message.create({data: {conversationId: conversation.id, role: 'USER', content: 'old wording', createdAt: timestamp}});
  await db.message.create({data: {conversationId: conversation.id, role: 'ASSISTANT', content: 'reply to old wording', createdAt: new Date(timestamp.getTime() + 1000)}});
  const foreign = await db.message.create({data: {conversationId: otherConversation.id, role: 'USER', content: 'other user history'}});

  await assert.rejects(() => editUserMessage(outsider.id, conversation.id, prompt.id, {content: 'forbidden'}), error => error instanceof ConversationMessageError && error.status === 403);
  await assert.rejects(() => editUserMessage(owner.id, conversation.id, foreign.id, {content: 'wrong conversation'}), error => error.status === 404);
  const edited = await editUserMessage(owner.id, conversation.id, prompt.id, {content: '  revised wording  '});
  assert.equal(edited.message.content, 'revised wording');
  assert.equal(edited.droppedReplies, 1);
  assert.equal(await db.message.count({where: {conversationId: conversation.id}}), 1);
  assert.equal(await db.message.findUnique({where: {id: foreign.id}}).then(row => row.content), 'other user history');

  const assistant = await db.message.create({data: {conversationId: conversation.id, role: 'ASSISTANT', content: 'cannot edit this'}});
  await assert.rejects(() => editUserMessage(owner.id, conversation.id, assistant.id, {content: 'altered reply'}), error => error.status === 400);

  const token = await signToken({userId: owner.id, email: owner.email});
  const response = await editRoute(new Request('http://local.test/api/conversations/message', {
    method: 'PATCH', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({content: 'HTTP revised wording'}),
  }), {params: Promise.resolve({id: conversation.id, messageId: prompt.id})});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).message.content, 'HTTP revised wording');
});

test('message likes are owner-scoped, idempotent and atomically timestamped; delete removes following history', async () => {
  const owner = await user('reaction_owner');
  const outsider = await user('reaction_outsider');
  const character = await db.character.create({data: {creatorId: owner.id, name: '反应测试角色', personality: 'synthetic', background: ''}});
  const conversation = await db.conversation.create({data: {userId: owner.id, characterId: character.id}});
  const other = await db.conversation.create({data: {userId: outsider.id, characterId: character.id}});
  const message = await db.message.create({data: {conversationId: conversation.id, role: 'ASSISTANT', content: 'synthetic reply'}});

  await assert.rejects(() => setMessageLiked(outsider.id, conversation.id, message.id, true), error => error.status === 403);
  await assert.rejects(() => setMessageLiked(owner.id, other.id, message.id, true), error => error.status === 404);
  const first = await setMessageLiked(owner.id, conversation.id, message.id, true);
  const second = await setMessageLiked(owner.id, conversation.id, message.id, true);
  assert.equal(first.likedAt.getTime(), second.likedAt.getTime());

  const token = await signToken({userId: owner.id, email: owner.email});
  const response = await likeRoute(new Request('http://local.test/api/conversations/message/like', {method: 'POST', headers: {Authorization: `Bearer ${token}`}}), {params: Promise.resolve({id: conversation.id, messageId: message.id})});
  assert.equal(response.status, 200);
  assert.equal(new Date((await response.json()).likedAt).getTime(), first.likedAt.getTime());
  assert.deepEqual(await deleteMessageAndFollowing(owner.id, conversation.id, message.id), {success: true, removed: 1});
  assert.equal(await db.message.findUnique({where: {id: message.id}}), null);
});

test('chat persistence writes replies and counters atomically while history stays scoped and ordered', async () => {
  const owner = await user('persistence_owner');
  const stranger = await user('persistence_stranger');
  const character = await db.character.create({data: {creatorId: owner.id, name: '持久化角色', personality: 'synthetic', background: ''}});
  const conversation = await db.conversation.create({data: {userId: owner.id, characterId: character.id}});
  const start = new Date('2026-10-01T00:00:00.000Z');
  await db.message.create({data: {conversationId: conversation.id, role: 'ASSISTANT', content: 'older answer', createdAt: start}});
  const userMessage = await createUserMessage(conversation.id, 'latest question');
  await db.message.update({where: {id: userMessage.id}, data: {createdAt: new Date(start.getTime() + 1000)}});
  const history = await readRecentMessageHistory(conversation.id, userMessage.id, 10);
  assert.deepEqual(history.map(row => row.content), ['older answer']);
  const before = await db.character.findUnique({where: {id: character.id}, select: {messageCount: true}});
  await persistAssistantResponse(conversation.id, character.id, 'new answer');
  assert.equal(await db.message.count({where: {conversationId: conversation.id}}), 3);
  assert.equal((await db.character.findUnique({where: {id: character.id}, select: {messageCount: true}})).messageCount, before.messageCount + 2);
  const messages = await readConversationMessages(owner.id, conversation.id);
  assert.deepEqual(messages.map(row => row.role), ['ASSISTANT', 'USER', 'ASSISTANT']);
  await persistAssistantResponse(conversation.id, character.id, '');
  assert.equal(await db.message.count({where: {conversationId: conversation.id}}), 3);
  assert.equal((await db.character.findUnique({where: {id: character.id}, select: {messageCount: true}})).messageCount, before.messageCount + 3);
  await assert.rejects(() => readConversationMessages(stranger.id, conversation.id), error => error instanceof ConversationMessageError && error.status === 403);
});

test('regeneration preparation scopes history and preserves the old reply until atomic replacement', async () => {
  const owner = await user('regeneration_owner');
  const character = await db.character.create({data: {creatorId: owner.id, name: '重生成角色', personality: 'synthetic', background: ''}});
  const conversation = await db.conversation.create({data: {userId: owner.id, characterId: character.id}});
  const timestamp = new Date('2026-10-13T00:00:00.000Z');
  const earlier = await db.message.create({data: {conversationId: conversation.id, role: 'USER', content: 'earlier question', createdAt: timestamp}});
  const prompt = await db.message.create({data: {conversationId: conversation.id, role: 'USER', content: 'current question', createdAt: new Date(timestamp.getTime() + 1000)}});
  const oldReply = await db.message.create({data: {conversationId: conversation.id, role: 'ASSISTANT', content: 'old answer', createdAt: new Date(timestamp.getTime() + 2000)}});
  const prepared = await prepareMessageRegeneration(owner.id, conversation.id, oldReply.id, 20);
  assert.equal(prepared.prompt.id, prompt.id);
  assert.deepEqual(prepared.history.map(row => row.content), ['earlier question']);
  assert.equal(await replaceMessageReply(conversation.id, prompt.createdAt, ''), null);
  assert.equal((await db.message.findUnique({where: {id: oldReply.id}})).content, 'old answer');
  await replaceMessageReply(conversation.id, prompt.createdAt, 'new answer');
  assert.equal(await db.message.findUnique({where: {id: oldReply.id}}), null);
  assert.equal((await db.message.findUnique({where: {id: earlier.id}})).content, 'earlier question');
  assert.equal(await db.message.count({where: {conversationId: conversation.id, role: 'ASSISTANT'}}), 1);
});
