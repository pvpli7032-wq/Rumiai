import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createIsolatedDatabase} from '../scripts/helpers/create-isolated-db.mjs';

const file = `scene-funnel-${process.pid}-${Date.now()}.db`;
// 用 node:sqlite 建隔离库：本机环境里 Prisma schema engine 会以 OS Error 5 被拦，
// 仓库约定一律走 create-isolated-db（见该文件头注释）。
createIsolatedDatabase(path.resolve('prisma', file));
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const {db} = await import('../src/lib/db.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {recordSceneFunnelEvent} = await import('../src/lib/analytics/scene-funnel-service.ts');
const {createOrReuseConversation} = await import('../src/lib/conversations/conversation-service.ts');
const {POST} = await import('../src/app/api/analytics/funnel-events/route.ts');
test.after(async () => { await db.$disconnect(); });

async function fixture() {
  const name = randomUUID();
  const owner = await db.user.create({data: {username: name, email: `${name}@example.invalid`, passwordHash: 'synthetic'}});
  const stranger = await db.user.create({data: {username: `${name}-other`, email: `${name}-other@example.invalid`, passwordHash: 'synthetic'}});
  const character = await db.character.create({data: {creatorId: owner.id, name: '测试角色', personality: 'PRIVATE_PERSONA', background: '', isPublic: true, reviewStatus: 'APPROVED'}});
  const {conversation} = await createOrReuseConversation(owner.id, {characterId: character.id});
  return {owner, stranger, conversation};
}

const eventCount = async conversationId => {
  const [row] = await db.$queryRaw`SELECT COUNT(*) AS n FROM scene_funnel_events WHERE conversation_id = ${conversationId}`;
  return Number(row.n);
};

test('same conversation and event only lands once; the four funnel nodes coexist', async () => {
  const f = await fixture();
  const target = {conversationId: f.conversation.id, sceneId: 'midnight-studio-melody-ch01'};
  await recordSceneFunnelEvent(f.owner.id, {...target, event: 'scene_opened'});
  await recordSceneFunnelEvent(f.owner.id, {...target, event: 'scene_opened'});
  assert.equal(await eventCount(f.conversation.id), 1);
  for (const event of ['scene_first_message_sent', 'scene_active_end_confirmed', 'scene_close_continue_clicked']) {
    await recordSceneFunnelEvent(f.owner.id, {...target, event});
  }
  assert.equal(await eventCount(f.conversation.id), 4);
});

test('unknown events, bad ids and foreign conversations are rejected without writing', async () => {
  const f = await fixture();
  const target = {conversationId: f.conversation.id, sceneId: 'midnight-studio-melody-ch01'};
  await assert.rejects(recordSceneFunnelEvent(f.owner.id, {...target, event: 'scene_browsed'}));
  await assert.rejects(recordSceneFunnelEvent(f.owner.id, {...target, conversationId: ''}));
  await assert.rejects(recordSceneFunnelEvent(f.owner.id, {...target, sceneId: 'x'.repeat(65)}));
  await assert.rejects(recordSceneFunnelEvent(f.stranger.id, {...target, event: 'scene_opened'}), error => error.status === 404);
  assert.equal(await eventCount(f.conversation.id), 0);
});

test('HTTP endpoint authenticates, validates and stays idempotent', async () => {
  const f = await fixture();
  const token = await signToken({userId: f.owner.id, email: f.owner.email});
  const request = body => new Request('http://local.test/api/analytics/funnel-events', {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: typeof body === 'string' ? body : JSON.stringify(body)})});
  assert.equal((await POST(new Request('http://local.test/api/analytics/funnel-events', {method: 'POST', body: '{}'}))).status, 401);
  assert.equal((await POST(request('{broken'))).status, 422);
  assert.equal((await POST(request({event: 'scene_opened', conversationId: 1, sceneId: 's'}))).status, 422);
  assert.equal((await POST(request({event: 'scene_opened', conversationId: f.conversation.id, sceneId: 'midnight-studio-melody-ch01'}))).status, 204);
  assert.equal((await POST(request({event: 'scene_opened', conversationId: f.conversation.id, sceneId: 'midnight-studio-melody-ch01'}))).status, 204);
  assert.equal(await eventCount(f.conversation.id), 1);
});

test('per-user reporting rate ceiling returns 429 without writing', async () => {
  const f = await fixture();
  const strangerToken = await signToken({userId: f.stranger.id, email: f.stranger.email});
  const strangerCharacter = await db.character.create({data: {creatorId: f.stranger.id, name: '测试角色乙', personality: 'PRIVATE_PERSONA', background: '', isPublic: true, reviewStatus: 'APPROVED'}});
  const {conversation} = await createOrReuseConversation(f.stranger.id, {characterId: strangerCharacter.id});
  for (let i = 0; i < 60; i++) {
    await recordSceneFunnelEvent(f.stranger.id, {event: 'scene_opened', conversationId: `${conversation.id}-${i}`.slice(0, 64), sceneId: 'midnight-studio-melody-ch01'}).catch(error => {
      if (error.status === 404) return;
      throw error;
    });
  }
  const request = new Request('http://local.test/api/analytics/funnel-events', {method: 'POST', headers: {Authorization: `Bearer ${strangerToken}`, 'Content-Type': 'application/json'}, body: JSON.stringify({event: 'scene_opened', conversationId: conversation.id, sceneId: 'midnight-studio-melody-ch01'})});
  const response = await POST(request);
  assert.equal(response.status, 429);
  assert.equal(typeof (await response.json()).error, 'string');
});
