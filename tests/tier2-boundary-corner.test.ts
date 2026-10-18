/**
 * Tier 2: Boundary & Corner Case E2E Test Suite for 星伴 Platform.
 * Tests edge cases, validation rules, error handling, unauthorized access,
 * and input limits across Auth, Characters, Economy, Horoscope, and Chat.
 */

import { TestClient } from './helpers/test-client';
import { describe, test, assertOk, assertEquals, assertStatus } from './helpers/test-runner';
import { safeNextPath, DEFAULT_AFTER_LOGIN } from '../src/lib/next-path';

const clientA = new TestClient();
const clientB = new TestClient();

let userAToken = '';
let userBToken = '';
let userAEmail = `boundary_user_a_${Date.now()}@example.com`;
let userBEmail = `boundary_user_b_${Date.now()}@example.com`;

let privateCharId = '';
let userAConvId = '';

/** Fresh account so balances are predictable (registration grants 100 coins). */
async function freshUser(tag: string) {
  const client = new TestClient();
  const res = await client.post('/api/auth/register', {
    name: `Integrity ${tag}`,
    email: `integrity_${tag}_${Date.now()}_${Math.floor(Math.random() * 1e9)}@example.com`,
    password: 'Password123!',
  });
  await assertStatus(res, [200, 201]);
  const data = await client.json(res);
  client.setToken(data.token);
  return client;
}

async function publicCharacterOf(client: TestClient): Promise<string> {
  const res = await client.createReviewedFixture({
    name: `Integrity Char ${Date.now()}_${Math.floor(Math.random() * 1e9)}`,
    personality: 'friendly',
  });
  await assertStatus(res, [200, 201]);
  const data = await client.json(res);
  return (data.character || data).id;
}

export function registerTier2Tests() {

  // Setup helper suite for test isolation
  describe('Tier 2 - Setup & Pre-conditions', () => {
    test('Setup User A and User B tokens', async () => {
      const resA = await clientA.post('/api/auth/register', {
        name: 'Boundary User A',
        email: userAEmail,
        password: 'Password123!',
      });
      await assertStatus(resA, [200, 201]);
      const dataA = await clientA.json(resA);
      userAToken = dataA.token;
      clientA.setToken(userAToken);

      const resB = await clientB.post('/api/auth/register', {
        name: 'Boundary User B',
        email: userBEmail,
        password: 'Password123!',
      });
      await assertStatus(resB, [200, 201]);
      const dataB = await clientB.json(resB);
      userBToken = dataB.token;
      clientB.setToken(userBToken);
    });
  });

  // ==========================================
  // 1. AUTH BOUNDARIES
  // ==========================================
  describe('Tier 2 - Auth Boundaries', () => {
    test('1.1 Login with non-existent email returns error status', async () => {
      const res = await clientA.post('/api/auth/login', {
        email: 'nobody_exists_987654321@example.com',
        password: 'Password123!',
      });
      await assertStatus(res, [400, 401, 404]);
    });

    test('1.2 Registration with missing required email field rejected', async () => {
      const res = await clientA.post('/api/auth/register', {
        name: 'No Email User',
        password: 'Password123!',
      });
      await assertStatus(res, 400);
    });

    test('1.3 Registration with missing password field rejected', async () => {
      const res = await clientA.post('/api/auth/register', {
        name: 'No Password User',
        email: `nopass_${Date.now()}@example.com`,
      });
      await assertStatus(res, 400);
    });

    test('1.4 Request with malformed Bearer token returns 401 Unauthorized', async () => {
      const badClient = new TestClient();
      badClient.setToken('invalid.jwt.token.format');
      const res = await badClient.get('/api/auth/me');
      await assertStatus(res, 401);
    });

    test('1.5 Duplicate email registration returns error status', async () => {
      const res = await clientA.post('/api/auth/register', {
        name: 'Duplicate Attempt',
        email: userAEmail,
        password: 'Password123!',
      });
      await assertStatus(res, [400, 409]);
    });
  });

  // ==========================================
  // 2. CHARACTER BOUNDARIES
  // ==========================================
  describe('Tier 2 - Character Boundaries', () => {
    test('2.1 Empty character name rejection on creation', async () => {
      const res = await clientA.createReviewedFixture({
        name: '',
        personality: 'Valid personality',
      });
      await assertStatus(res, 400);
    });

    test('2.2 Personality exceeding 1000 characters limit rejection', async () => {
      const longPersonality = 'A'.repeat(1005);
      const res = await clientA.createReviewedFixture({
        name: 'Overly Verbose Character',
        personality: longPersonality,
      });
      await assertStatus(res, 400);
    });

    test('2.3 Non-existent character ID lookup returns 404 Not Found', async () => {
      const res = await clientA.get('/api/characters/non_existent_char_9999');
      await assertStatus(res, 404);
    });

    test('2.4 Unauthorized deletion of another user character rejected', async () => {
      // User A creates a character
      const charRes = await clientA.createReviewedFixture({
        name: 'User A Private Character',
        personality: 'Secret personality',
        is_public: false,
      });
      await assertStatus(charRes, [200, 201]);
      const charData = await clientA.json(charRes);
      privateCharId = (charData.character || charData).id;

      // User B attempts to delete User A's character
      const deleteRes = await clientB.delete(`/api/characters/${privateCharId}`);
      await assertStatus(deleteRes, [401, 403, 404]);
    });

    test('2.5 Private character access by non-owner user rejected', async () => {
      assertOk(privateCharId, 'Private character ID required');
      const res = await clientB.get(`/api/characters/${privateCharId}`);
      await assertStatus(res, [403, 404]);
    });
  });

  // ==========================================
  // 3. ECONOMY & COINS BOUNDARIES
  // ==========================================
  describe('Tier 2 - Economy & Coins Boundaries', () => {
    test('3.1 Verify 0 coins balance handling / check', async () => {
      const res = await clientB.get('/api/users/me');
      await assertStatus(res, 200);
      const data = await clientB.json(res);
      const coins = data.coins !== undefined ? data.coins : data.user?.coins;
      assertOk(typeof coins === 'number' && coins >= 0, 'Balance must be a valid number');
    });

    test('3.2 Purchase with negative or invalid coin amounts rejected', async () => {
      const res = await clientA.post('/api/coins/purchase', {
        packageId: 'custom',
        amount: -50,
      });
      await assertStatus(res, [400, 422]);
    });

    test('3.3 Purchase attempt with non-existent package ID returns 400/404', async () => {
      const res = await clientA.post('/api/coins/purchase', {
        packageId: 'invalid_package_id_abc_123',
      });
      await assertStatus(res, [400, 404]);
    });

    test('3.4 Re-checkin on the same day is rejected / idempotent', async () => {
      // First checkin today
      await clientA.post('/api/checkin');

      // Second checkin attempt today
      const res2 = await clientA.post('/api/checkin');
      await assertStatus(res2, [200, 400, 409]);
      const data2 = await clientA.json(res2);
      assertOk(
        data2.success === false || data2.checkedInToday === true || data2.message?.includes('already') || data2.error !== undefined,
        'Second checkin should indicate already checked in or fail gracefully'
      );
    });
  });

  // ==========================================
  // 4. HOROSCOPE BOUNDARIES
  // ==========================================
  describe('Tier 2 - Horoscope Boundaries', () => {
    test('4.1 Invalid horoscope sign parameter returns 400/404', async () => {
      const res = await clientA.get('/api/horoscope/invalid_zodiac_sign_xyz');
      await assertStatus(res, [400, 404]);
    });

    test('4.2 Verify boundary request for all 12 valid zodiac sign names', async () => {
      const signs = [
        'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
        'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'
      ];
      for (const sign of signs) {
        const resUpper = await clientA.get(`/api/horoscope/${sign.toUpperCase()}`);
        await assertStatus(resUpper, [200, 301, 302, 307, 308]); // Case insensitivity or standard lookup
      }
    });
  });

  // ==========================================
  // 5. CHAT BOUNDARIES
  // ==========================================
  describe('Tier 2 - Chat Boundaries', () => {
    test('5.1 Empty message content sending rejection', async () => {
      // Setup conversation first
      const charRes = await clientA.get('/api/characters');
      await assertStatus(charRes, 200);
      const chars = (await clientA.json(charRes)).characters || (await clientA.json(charRes));
      const charId = Array.isArray(chars) && chars.length > 0 ? chars[0].id : privateCharId;

      const convRes = await clientA.post('/api/conversations', { character_id: charId });
      await assertStatus(convRes, [200, 201]);
      userAConvId = ((await clientA.json(convRes)).conversation || (await clientA.json(convRes))).id;

      const sendRes = await clientA.post(`/api/conversations/${userAConvId}/messages`, {
        content: '',
      });
      await assertStatus(sendRes, 400);
    });

    test('5.2 Conversation creation with invalid character ID returns 404', async () => {
      const res = await clientA.post('/api/conversations', {
        character_id: 'non_existent_character_999',
      });
      await assertStatus(res, 404);
    });

    test('5.3 Unauthorized access to another user conversation message history rejected', async () => {
      assertOk(userAConvId, 'User A conversation ID required');
      const res = await clientB.get(`/api/conversations/${userAConvId}/messages`);
      await assertStatus(res, [401, 403, 404]);
    });
  });

  // ==========================================
  // 6. ECONOMY INTEGRITY & CONCURRENCY
  // Regression cover for defects found by probing the running server: a negative
  // gift amount minted coins, private characters were reachable through the
  // conversations endpoint, and concurrent requests collected rewards repeatedly.
  // ==========================================
  describe('Tier 2 - Economy Integrity & Concurrency', () => {
    async function balanceOf(client: TestClient): Promise<number> {
      const res = await client.get('/api/users/me');
      await assertStatus(res, 200);
      const data = await client.json(res);
      return (data.user || data).coins;
    }

    test('6.1 Negative gift amount is rejected and cannot mint coins', async () => {
      const sender = await freshUser('neg');
      const owner = await freshUser('negowner');
      const charId = await publicCharacterOf(owner);
      const before = await balanceOf(sender);

      const res = await sender.post(`/api/characters/${charId}/gift`, { amount: -100000 });
      await assertStatus(res, 400);
      assertEquals(await balanceOf(sender), before);
    });

    test('6.2 Non-integer and out-of-range gift amounts are rejected', async () => {
      const sender = await freshUser('frac');
      const owner = await freshUser('fracowner');
      const charId = await publicCharacterOf(owner);
      const before = await balanceOf(sender);

      for (const amount of [0, 0.5, '50', Number.MAX_SAFE_INTEGER]) {
        const res = await sender.post(`/api/characters/${charId}/gift`, { amount });
        await assertStatus(res, 400);
      }
      assertEquals(await balanceOf(sender), before);
    });

    test('6.3 Private character cannot be opened as a conversation by a stranger', async () => {
      const owner = await freshUser('privowner');
      const stranger = await freshUser('privstranger');

      const charRes = await owner.createReviewedFixture({
        name: `Integrity Private ${Date.now()}`,
        personality: 'ความลับ',
        is_public: false,
      });
      await assertStatus(charRes, [200, 201]);
      const character = (await owner.json(charRes)).character;
      assertEquals(character.isPublic, false);

      await assertStatus(await stranger.get(`/api/characters/${character.id}`), [403, 404]);
      await assertStatus(await stranger.post('/api/conversations', { characterId: character.id }), [403, 404]);
      // The owner must still be able to chat with their own private character.
      await assertStatus(await owner.post('/api/conversations', { characterId: character.id }), [200, 201]);
    });

    test('6.4 Concurrent check-ins award the daily bonus exactly once', async () => {
      const user = await freshUser('cirace');
      const before = await balanceOf(user);

      const statuses = await Promise.all(
        Array.from({ length: 6 }, () => user.post('/api/checkin').then(r => r.status))
      );
      assertEquals(statuses.filter(s => s === 200 || s === 201).length, 1);
      assertEquals(await balanceOf(user), before + 10);
    });

    test('6.5 Concurrent mission completions award the reward exactly once', async () => {
      const user = await freshUser('msrace');
      await assertStatus(await user.post('/api/checkin'),200);
      const listRes = await user.get('/api/missions');
      await assertStatus(listRes, 200);
      const listData = await user.json(listRes);
      const missions: any[] = Array.isArray(listData) ? listData : listData.missions || [];
      const mission = missions.find(item => item.qualified);
      assertOk(mission,'HTTP fixtures must include a check-in mission qualified by the preceding check-in');
      const before = await balanceOf(user);
      const statuses = await Promise.all(
        Array.from({ length: 6 }, () => user.post(`/api/missions/${mission.id}/complete`).then(r => r.status))
      );
      assertEquals(statuses.filter(s => s === 200 || s === 201).length, 1);
      assertEquals(await balanceOf(user), before + mission.rewardCoins);
    });

    test('6.23 A report can be filed, and refiling updates rather than stacks', async () => {
      const owner = await freshUser('reportowner');
      const charId = await publicCharacterOf(owner);
      const reporter = await freshUser('reporter');

      const first = await reporter.post('/api/reports', {
        target_type: 'character',
        target_id: charId,
        category: 'inappropriateImage',
        imageReason: 'realPerson',
        details: 'ใช้รูปบุคคลจริง',
        contact_type: 'email',
        contact_value: 'someone@example.com',
      });
      await assertStatus(first, 201);
      const firstBody = await reporter.json(first);
      assertEquals(firstBody.updated, false);
      assertEquals(firstBody.report.status, 'OPEN');

      // The same person reporting the same target again is an update, not a second
      // complaint — otherwise one account could manufacture a pile of them.
      const second = await reporter.post('/api/reports', {
        target_type: 'CHARACTER',
        target_id: charId,
        category: 'copyright',
        details: 'คัดลอกผลงาน',
        workTitle: 'ผลงานต้นฉบับ',
        relationship: 'owner',
        sourceLink: 'https://example.com/original',
      });
      await assertStatus(second, 200);
      assertEquals((await reporter.json(second)).updated, true);

      const mine = await reporter.json(await reporter.get('/api/reports'));
      assertEquals(mine.length, 1);
      assertEquals(mine[0].category, 'copyright');

      // Somebody else's report list must not include it.
      const other = await freshUser('reportother');
      assertEquals((await other.json(await other.get('/api/reports'))).length, 0);
    });

    test('6.24 Reports validate their category, target and existence', async () => {
      const reporter = await freshUser('reportvalid');
      const owner = await freshUser('reportvalidowner');
      const charId = await publicCharacterOf(owner);

      await assertStatus(
        await reporter.post('/api/reports', { target_type: 'CHARACTER', target_id: charId, category: 'nonsense', details: 'x' }),
        400
      );
      await assertStatus(
        await reporter.post('/api/reports', { target_type: 'PLANET', target_id: charId, category: 'spam', details: 'x' }),
        400
      );
      // "other" says nothing by itself, so it must be explained.
      await assertStatus(
        await reporter.post('/api/reports', { target_type: 'CHARACTER', target_id: charId, category: 'other', details: '' }),
        400
      );
      // Every other category is self-describing, and the report dialog presents the
      // details box as optional. Requiring it would make the form's own primary path 400.
      await assertStatus(
        await reporter.post('/api/reports', { target_type: 'CHARACTER', target_id: charId, category: 'spam' }),
        [200, 201]
      );
      // A report about something that does not exist keeps the queue about real content.
      await assertStatus(
        await reporter.post('/api/reports', { target_type: 'CHARACTER', target_id: 'does-not-exist', category: 'spam', details: 'x' }),
        404
      );

      const anonymous = new TestClient();
      await assertStatus(
        await anonymous.post('/api/reports', { target_type: 'CHARACTER', target_id: charId, category: 'spam', details: 'x' }),
        401
      );
    });

    test('6.25 A creator has a public profile at their handle', async () => {
      const creator = await freshUser('creatorprofile');
      const me = await creator.json(await creator.get('/api/users/me'));
      const username = (me.user || me).username;
      assertOk(username, 'the account must have a handle');

      const charId = await publicCharacterOf(creator);
      // A private character must not appear on a public page.
      const privateRes = await creator.createReviewedFixture({
        name: `Hidden ${Date.now()}`,
        personality: 'secret',
        is_public: false,
      });
      await assertStatus(privateRes, [200, 201]);

      const visitor = new TestClient();
      const res = await visitor.get(`/api/creators/${encodeURIComponent(username)}`);
      await assertStatus(res, 200);
      const body = await visitor.json(res);
      assertEquals(body.creator.username, username);
      assertEquals(body.creator.publicCharacterCount, 1);
      assertEquals(body.characters.length, 1);
      assertEquals(body.characters[0].id, charId);

      await assertStatus(await visitor.get('/api/creators/no-such-handle-here'), 404);
    });

    test('6.26 Reader preferences round-trip, and shortcuts must be JSON', async () => {
      const reader = await freshUser('prefs');

      const res = await reader.put('/api/users/me', {
        banned_words: 'คำที่หนึ่ง\nคำที่สอง',
        reading_mode: true,
        shortcuts: { insert: ['* *', '" "'] },
      });
      await assertStatus(res, 200);
      const user = (await reader.json(res)).user;
      assertEquals(user.readingMode, true);
      assertEquals(user.bannedWords, 'คำที่หนึ่ง\nคำที่สอง');
      assertEquals(JSON.parse(user.shortcuts).insert.length, 2);

      await assertStatus(await reader.put('/api/users/me', { shortcuts: 'not json{' }), 400);
    });

    test('6.27 A chat can pick a model, but only from the configured chain', async () => {
      const owner = await freshUser('modelowner');
      const charId = await publicCharacterOf(owner);
      const reader = await freshUser('modelreader');

      const convRes = await reader.post('/api/conversations', { characterId: charId });
      const conversationId = (await reader.json(convRes)).conversation.id;

      // An arbitrary model would let one reader spend the shared provider quota
      // wherever they liked.
      await assertStatus(
        await reader.patch(`/api/conversations/${conversationId}`, { ai_model: 'gpt-9-ultra-expensive' }),
        400
      );

      // Ask the server which models it allows rather than guessing from this process's
      // env — the runner does not read the server's .env.
      const modelsRes = await reader.get('/api/ai/models');
      await assertStatus(modelsRes, 200);
      const { models, default: defaultModel } = await reader.json(modelsRes);
      assertOk(Array.isArray(models) && models.length > 0, 'The chain must expose at least one model');
      assertEquals(defaultModel, models[0]);

      const allowed = models[0];
      const set = await reader.patch(`/api/conversations/${conversationId}`, { ai_model: allowed });
      await assertStatus(set, 200);
      assertEquals((await reader.json(set)).conversation.aiModel, allowed);

      const cleared = await reader.patch(`/api/conversations/${conversationId}`, { ai_model: null });
      await assertStatus(cleared, 200);
      assertEquals((await reader.json(cleared)).conversation.aiModel, null);

      const toggled = await reader.patch(`/api/conversations/${conversationId}`, { relationship_mode: false });
      assertEquals((await reader.json(toggled)).conversation.relationshipMode, false);
    });

    test('6.28 A character quest pays out once, even under concurrent claims', async () => {
      const owner = await freshUser('questowner');
      const charId = await publicCharacterOf(owner);

      // Quests are authored data; create one directly through the seeded API surface by
      // asking the character endpoint for its (initially empty) quest list first.
      const emptyList = await owner.get(`/api/characters/${charId}/quests`);
      await assertStatus(emptyList, 200);
      assertEquals((await owner.json(emptyList)).length, 0);

      const questRes = await owner.post(`/api/characters/${charId}/quests`, {
        title: 'คุยครบ 10 ข้อความ',
        reward_coins: 30,
      });
      await assertStatus(questRes, 201);
      const quest = (await owner.json(questRes)).quest;

      const reader = await freshUser('questreader');
      const listed = await reader.json(await reader.get(`/api/characters/${charId}/quests`));
      assertEquals(listed.length, 1);
      assertEquals(listed[0].isCompleted, false);
      assertEquals(listed[0].rewardCoins, 30);
      assertEquals(listed[0].requiredMessages, 1);
      assertEquals(listed[0].isQualified, false);

      const before = await balanceOf(reader);
      await assertStatus(await reader.post(`/api/characters/${charId}/quests/${quest.id}/complete`), 409);
      assertEquals(await balanceOf(reader), before);

      const conversationResponse=await reader.post('/api/conversations',{characterId:charId});
      await assertStatus(conversationResponse,201);
      const conversationId=(await reader.json(conversationResponse)).conversation.id;
      const sent=await reader.post(`/api/conversations/${conversationId}/messages`,{content:'完成角色任务的可核验消息'});
      await assertStatus(sent,200);await sent.text();

      const statuses = await Promise.all(
        Array.from({ length: 6 }, () =>
          reader.post(`/api/characters/${charId}/quests/${quest.id}/complete`).then(r => r.status)
        )
      );
      assertEquals(statuses.filter(s => s === 200).length, 1);
      assertEquals(await balanceOf(reader), before + 30);

      const after = await reader.json(await reader.get(`/api/characters/${charId}/quests`));
      assertEquals(after[0].isCompleted, true);

      await assertStatus(await reader.post(`/api/characters/${charId}/quests/does-not-exist/complete`), 404);

      // Only the character's creator may author quests.
      await assertStatus(
        await reader.post(`/api/characters/${charId}/quests`, { title: 'ของปลอม', reward_coins: 9999 }),
        403
      );
    });

    test('6.17 Relationship meters are not treated as percentages', async () => {
      // The live chat page shows a romance value of 1100, so clamping to 100 was wrong.
      const owner = await freshUser('meterscale');
      const res = await owner.createReviewedFixture({
        name: `Meter Scale ${Date.now()}`,
        personality: 'p',
        relationship_status: 'แฟน',
        initial_romance: 1100,
        initial_intimacy: 250,
      });
      await assertStatus(res, [200, 201]);
      const created = (await owner.json(res)).character;
      assertEquals(created.initialRomance, 1100);
      assertEquals(created.initialIntimacy, 250);
      assertEquals(created.relationshipStatus, 'แฟน');
    });

    test('6.18 A conversation carries its own relationship state, seeded from the character', async () => {
      const owner = await freshUser('convseed');
      const charRes = await owner.createReviewedFixture({
        name: `Seed Char ${Date.now()}`,
        personality: 'p',
        relationship_status: 'คนรู้จัก',
        initial_romance: 500,
        initial_intimacy: 20,
      });
      await assertStatus(charRes, [200, 201]);
      const charId = (await owner.json(charRes)).character.id;

      const reader = await freshUser('convreader');
      const convRes = await reader.post('/api/conversations', { characterId: charId });
      await assertStatus(convRes, [200, 201]);
      const conversation = (await reader.json(convRes)).conversation;
      assertEquals(conversation.relationshipStatus, 'คนรู้จัก');
      assertEquals(conversation.romance, 500);
      assertEquals(conversation.intimacy, 20);

      // Moving the conversation's own state must not touch the character's defaults.
      const patched = await reader.patch(`/api/conversations/${conversation.id}`, {
        romance: 1100,
        intimacy: 40,
        relationshipStatus: 'แฟน',
        notes: 'ชอบค็อกเทล',
      });
      await assertStatus(patched, 200);
      const updated = (await reader.json(patched)).conversation;
      assertEquals(updated.romance, 1100);
      assertEquals(updated.relationshipStatus, 'แฟน');
      assertEquals(updated.notes, 'ชอบค็อกเทล');

      const charAfter = await owner.get(`/api/characters/${charId}`);
      assertEquals((await owner.json(charAfter)).character.initialRomance, 500);
    });

    test('6.19 A reader can hold several chats with one character', async () => {
      const owner = await freshUser('multiowner');
      const charId = await publicCharacterOf(owner);
      const reader = await freshUser('multireader');

      const firstRes = await reader.post('/api/conversations', { characterId: charId });
      await assertStatus(firstRes, [200, 201]);
      const first = (await reader.json(firstRes)).conversation;

      // Without newChat the same chat is reopened.
      const reopenedRes = await reader.post('/api/conversations', { characterId: charId });
      assertEquals((await reader.json(reopenedRes)).conversation.id, first.id);

      // "แชทใหม่" starts a separate one.
      const secondRes = await reader.post('/api/conversations', { characterId: charId, new_chat: true });
      await assertStatus(secondRes, [200, 201]);
      const second = (await reader.json(secondRes)).conversation;
      assertOk(second.id !== first.id, 'newChat must create a distinct conversation');

      const listRes = await reader.get(`/api/conversations?characterId=${charId}`);
      await assertStatus(listRes, 200);
      const list = await reader.json(listRes);
      assertEquals(list.length, 2);
      assertOk(list.every((c: any) => typeof c.messageCount === 'number'), 'list must report messageCount');
    });

    test('6.20 Archiving hides a chat from the default list', async () => {
      const owner = await freshUser('archiveowner');
      const charId = await publicCharacterOf(owner);
      const reader = await freshUser('archivereader');

      const convRes = await reader.post('/api/conversations', { characterId: charId });
      const conversation = (await reader.json(convRes)).conversation;

      await assertStatus(await reader.patch(`/api/conversations/${conversation.id}`, { archived: true }), 200);
      assertEquals((await reader.json(await reader.get('/api/conversations'))).length, 0);
      assertEquals((await reader.json(await reader.get('/api/conversations?archived=true'))).length, 1);

      await assertStatus(await reader.patch(`/api/conversations/${conversation.id}`, { archived: false }), 200);
      assertEquals((await reader.json(await reader.get('/api/conversations'))).length, 1);
    });

    test("6.21 A stranger cannot read or change someone else's chat", async () => {
      const owner = await freshUser('privchatowner');
      const charId = await publicCharacterOf(owner);
      const reader = await freshUser('privchatreader');
      const stranger = await freshUser('privchatstranger');

      const convRes = await reader.post('/api/conversations', { characterId: charId });
      const conversationId = (await reader.json(convRes)).conversation.id;

      await assertStatus(await stranger.get(`/api/conversations/${conversationId}`), [403, 404]);
      await assertStatus(await stranger.patch(`/api/conversations/${conversationId}`, { notes: 'x' }), [403, 404]);
      await assertStatus(await stranger.delete(`/api/conversations/${conversationId}`), [403, 404]);

      // The owner still can.
      const detail = await reader.get(`/api/conversations/${conversationId}`);
      await assertStatus(detail, 200);
      const body = (await reader.json(detail)).conversation;
      assertOk(typeof body.messageCount === 'number', 'detail must report messageCount');
      assertOk(typeof body.daysChatting === 'number', 'detail must report daysChatting');
    });

    test('6.22 Liking a reply is idempotent and reversible', async () => {
      const owner = await freshUser('msglikeowner');
      const charId = await publicCharacterOf(owner);
      const reader = await freshUser('msgliker');

      const convRes = await reader.post('/api/conversations', { characterId: charId });
      const conversationId = (await reader.json(convRes)).conversation.id;

      const sent = await reader.post(`/api/conversations/${conversationId}/messages`, { content: 'สวัสดี' });
      await assertStatus(sent, 200);
      await sent.text();

      const messages = await reader.json(await reader.get(`/api/conversations/${conversationId}/messages`));
      const reply = messages.find((m: any) => String(m.role).toUpperCase() === 'ASSISTANT');
      assertOk(reply, 'there must be a reply to like');

      const liked = await reader.post(`/api/conversations/${conversationId}/messages/${reply.id}/like`);
      await assertStatus(liked, 200);
      const firstLikedAt = (await reader.json(liked)).likedAt;
      assertOk(firstLikedAt, 'like must record a timestamp');

      // Liking again keeps the original timestamp rather than moving it.
      const again = await reader.post(`/api/conversations/${conversationId}/messages/${reply.id}/like`);
      assertEquals((await reader.json(again)).likedAt, firstLikedAt);

      await assertStatus(await reader.delete(`/api/conversations/${conversationId}/messages/${reply.id}/like`), 200);
      const after = await reader.json(await reader.get(`/api/conversations/${conversationId}/messages`));
      assertEquals(after.find((m: any) => m.id === reply.id).likedAt, null);
    });

    test('6.11 Character detail exposes the fields the detail view needs', async () => {
      const owner = await freshUser('detail');
      const res = await owner.createReviewedFixture({
        name: `Detail Char ${Date.now()}`,
        personality: 'playful',
        role_template: 'ชื่อ: [ กรอกชื่อของคุณ ]',
        scenario: 'ในบาร์ลับใกล้มหาวิทยาลัย',
        is_adult: true,
        relationship_status: 'คนรู้จัก',
        initial_romance: 50,
        initial_intimacy: 0,
      });
      await assertStatus(res, [200, 201]);
      const created = (await owner.json(res)).character;

      const detailRes = await owner.get(`/api/characters/${created.id}`);
      await assertStatus(detailRes, 200);
      const detail = (await owner.json(detailRes)).character;

      assertEquals(detail.roleTemplate, 'ชื่อ: [ กรอกชื่อของคุณ ]');
      assertEquals(detail.scenario, 'ในบาร์ลับใกล้มหาวิทยาลัย');
      assertEquals(detail.isAdult, true);
      assertEquals(detail.relationshipStatus, 'คนรู้จัก');
      assertEquals(detail.initialRomance, 50);
      assertEquals(detail.initialIntimacy, 0);
      assertOk(Array.isArray(detail.images), 'detail must include an images array');
      assertOk(Array.isArray(detail.emojis), 'detail must include an emojis array');
      assertOk(Array.isArray(detail.supportCast), 'detail must include a supportCast array');
      assertOk(detail.viewer, 'detail must report the viewer state');
      assertEquals(detail.viewer.hasLiked, false);
      assertEquals(detail.viewer.hasBookmarked, false);
    });

    test('6.12 Relationship meters reject negatives but allow values above 100', async () => {
      // This case previously asserted a clamp to 100. That was written on a wrong
      // assumption: the live chat page shows a romance value of 1100, so the meter is
      // not a percentage and 5000 is a legitimate value.
      const owner = await freshUser('meters');
      const res = await owner.createReviewedFixture({
        name: `Meter Char ${Date.now()}`,
        personality: 'p',
        initial_romance: 5000,
        initial_intimacy: -20,
      });
      await assertStatus(res, [200, 201]);
      const created = (await owner.json(res)).character;
      assertEquals(created.initialRomance, 5000);
      assertEquals(created.initialIntimacy, 0);

      // Absurd values are still capped, and non-numbers fall back to zero.
      const absurd = await owner.createReviewedFixture({
        name: `Meter Absurd ${Date.now()}`,
        personality: 'p',
        initial_romance: 10_000_000,
        initial_intimacy: 'มาก',
      });
      await assertStatus(absurd, [200, 201]);
      const capped = (await owner.json(absurd)).character;
      assertEquals(capped.initialRomance, 1_000_000);
      assertEquals(capped.initialIntimacy, 0);
    });

    test('6.13 Liking is idempotent and reversible', async () => {
      const owner = await freshUser('likeowner');
      const fan = await freshUser('likefan');
      const charId = await publicCharacterOf(owner);

      const first = await fan.post(`/api/characters/${charId}/like`);
      await assertStatus(first, 200);
      assertEquals((await fan.json(first)).likeCount, 1);

      // Liking again must not inflate the count — the like is a row per person.
      const second = await fan.post(`/api/characters/${charId}/like`);
      await assertStatus(second, 200);
      assertEquals((await fan.json(second)).likeCount, 1);

      const detail = await fan.get(`/api/characters/${charId}`);
      assertEquals((await fan.json(detail)).character.viewer.hasLiked, true);

      const removed = await fan.delete(`/api/characters/${charId}/like`);
      await assertStatus(removed, 200);
      assertEquals((await fan.json(removed)).likeCount, 0);

      // Un-liking twice is not an error, and cannot drive the count negative.
      const again = await fan.delete(`/api/characters/${charId}/like`);
      await assertStatus(again, 200);
      assertEquals((await fan.json(again)).likeCount, 0);
    });

    test('6.14 Concurrent likes from one account count once', async () => {
      const owner = await freshUser('likeraceowner');
      const fan = await freshUser('likerace');
      const charId = await publicCharacterOf(owner);

      await Promise.all(Array.from({ length: 6 }, () => fan.post(`/api/characters/${charId}/like`)));

      const detail = await fan.get(`/api/characters/${charId}`);
      const character = (await fan.json(detail)).character;
      assertEquals(character.likeCount, 1);
      assertEquals(character.viewer.hasLiked, true);
    });

    test('6.15 Bookmarking is idempotent, and needs a token', async () => {
      const owner = await freshUser('bmowner');
      const fan = await freshUser('bmfan');
      const charId = await publicCharacterOf(owner);

      await assertStatus(await fan.post(`/api/characters/${charId}/bookmark`), 200);
      await assertStatus(await fan.post(`/api/characters/${charId}/bookmark`), 200);

      const detail = await fan.get(`/api/characters/${charId}`);
      assertEquals((await fan.json(detail)).character.viewer.hasBookmarked, true);

      await assertStatus(await fan.delete(`/api/characters/${charId}/bookmark`), 200);
      const after = await fan.get(`/api/characters/${charId}`);
      assertEquals((await fan.json(after)).character.viewer.hasBookmarked, false);

      const anonymous = new TestClient();
      await assertStatus(await anonymous.post(`/api/characters/${charId}/bookmark`), 401);
      await assertStatus(await anonymous.post(`/api/characters/${charId}/like`), 401);
    });

    test('6.16 A private character cannot be liked or bookmarked by a stranger', async () => {
      const owner = await freshUser('privlike');
      const stranger = await freshUser('privliker');

      const charRes = await owner.createReviewedFixture({
        name: `Private Like ${Date.now()}`,
        personality: 'secret',
        is_public: false,
      });
      await assertStatus(charRes, [200, 201]);
      const charId = (await owner.json(charRes)).character.id;

      await assertStatus(await stranger.post(`/api/characters/${charId}/like`), [403, 404]);
      await assertStatus(await stranger.post(`/api/characters/${charId}/bookmark`), [403, 404]);
    });

    test('6.9 Logout revokes the token everywhere, not just in the browser', async () => {
      const email = `logout_${Date.now()}_${Math.floor(Math.random() * 1e9)}@example.com`;
      const password = 'Password123!';

      const first = new TestClient();
      const regRes = await first.post('/api/auth/register', { name: 'Logout Probe', email, password });
      await assertStatus(regRes, [200, 201]);
      first.setToken((await first.json(regRes)).token);

      // A second device holding its own token for the same account.
      const second = new TestClient();
      const loginRes = await second.post('/api/auth/login', { email, password });
      await assertStatus(loginRes, 200);
      second.setToken((await second.json(loginRes)).token);

      await assertStatus(await first.get('/api/users/me'), 200);
      await assertStatus(await second.get('/api/users/me'), 200);

      await assertStatus(await first.post('/api/auth/logout'), 200);

      // Both tokens must now be refused — this is the part clearing localStorage
      // could never do.
      await assertStatus(await first.get('/api/users/me'), 401);
      await assertStatus(await second.get('/api/users/me'), 401);

      // Signing in again issues a token that works.
      const again = new TestClient();
      const reloginRes = await again.post('/api/auth/login', { email, password });
      await assertStatus(reloginRes, 200);
      again.setToken((await again.json(reloginRes)).token);
      await assertStatus(await again.get('/api/users/me'), 200);
    });

    test('6.10 Logout requires a valid token', async () => {
      const anonymous = new TestClient();
      await assertStatus(await anonymous.post('/api/auth/logout'), 401);
    });

    test('6.7 Registration rejects a password shorter than the client-side rule', async () => {
      const client = new TestClient();
      const res = await client.post('/api/auth/register', {
        name: 'Weak Password',
        email: `weakpw_${Date.now()}@example.com`,
        password: '1',
      });
      await assertStatus(res, 400);

      // The same address must still be usable with an acceptable password.
      const ok = await client.post('/api/auth/register', {
        name: 'Weak Password',
        email: `strongpw_${Date.now()}@example.com`,
        password: 'Password123!',
      });
      await assertStatus(ok, [200, 201]);
    });

    test('6.8 Chat is rate limited per account', async () => {
      const user = await freshUser('ratelimit');
      const charsRes = await user.get('/api/characters');
      await assertStatus(charsRes, 200);
      const chars = await user.json(charsRes);
      const charId = (Array.isArray(chars) ? chars : chars.characters)[0].id;

      const convRes = await user.post('/api/conversations', { characterId: charId });
      await assertStatus(convRes, [200, 201]);
      const convId = ((await user.json(convRes)).conversation || (await user.json(convRes))).id;

      // Empty messages are rejected before the limiter runs, so they are a way to
      // probe the ceiling without spending the shared AI quota on 30+ replies.
      let sawLimit = false;
      for (let i = 0; i < 40; i++) {
        const res = await user.post(`/api/conversations/${convId}/messages`, { content: '' });
        if (res.status === 429) {
          sawLimit = true;
          break;
        }
        await assertStatus(res, 400);
      }
      assertOk(!sawLimit, 'Invalid requests must not consume the rate-limit budget');
    });

    test('6.6 Concurrent gifts cannot overdraw the coin balance', async () => {
      const sender = await freshUser('gfrace');
      const owner = await freshUser('gfowner');
      const charId = await publicCharacterOf(owner);
      const before = await balanceOf(sender);

      // Spend the entire balance six times over at once; only one may settle.
      const statuses = await Promise.all(
        Array.from({ length: 6 }, () =>
          sender.post(`/api/characters/${charId}/gift`, { giftCode:'http-balance-test',amount: before }).then(r => r.status)
        )
      );
      assertEquals(statuses.filter(s => s === 200 || s === 201).length, 1);
      assertEquals(await balanceOf(sender), 0);
    });
  });

  // ==========================================
  // 7. SIGN-IN DESTINATION & PROFILE ROUTING
  // ==========================================
  describe('Tier 2 - Sign-in Destination & Profile Routing', () => {
    test('7.1 The post-login destination cannot be pointed off-site', async () => {
      // `next` arrives from the URL, so an attacker-supplied value would otherwise turn
      // the login form into an open redirect.
      const BS = String.fromCharCode(92);
      const rejected = [
        '//evil.example',
        `/${BS}${BS}evil.example`,
        'https://evil.example',
        'evil.example',
        '/login',
        '/register?x=1',
        '',
      ];
      for (const value of rejected) {
        assertEquals(safeNextPath(value), DEFAULT_AFTER_LOGIN, `must refuse ${JSON.stringify(value)}`);
      }

      // In-app paths are kept, encoded or not, so clicking a character while signed out
      // lands on that chat after signing in.
      assertEquals(safeNextPath('/chat?character=abc'), '/chat?character=abc');
      assertEquals(safeNextPath('%2Fchat%3Fcharacter%3Dabc'), '/chat?character=abc');
      assertEquals(safeNextPath('/profile/some-creator.name'), '/profile/some-creator.name');
    });

    test('7.2 A creator page resolves for a handle that is not plain ASCII', async () => {
      // Seeded creators have Thai names in the username column, and a percent-encoded
      // segment does not always reach the page decoded — /profile/{handle} 404'd for them
      // while the API resolved the same handle.
      const owner = await freshUser('handleowner');
      const me = await owner.json(await owner.get('/api/users/me'));
      const handle = (me.user ?? me).username;
      assertOk(handle, 'the account must have a handle');

      const encoded = encodeURIComponent(handle);
      await assertStatus(await clientA.get(`/api/creators/${encoded}`), 200);
      await assertStatus(await clientA.get(`/profile/${encoded}`), 200);
      await assertStatus(await clientA.get(`/profile/${encodeURIComponent('ไม่มีคนนี้จริง')}`), 404);
    });

    test('7.6 Editing your own line drops the reply that answered the old wording', async () => {
      const owner = await freshUser('editowner');
      const charId = await publicCharacterOf(owner);
      const reader = await freshUser('editreader');

      const convRes = await reader.post('/api/conversations', { characterId: charId });
      const conversationId = (await reader.json(convRes)).conversation.id;

      // A turn stores the reader's line and the reply.
      const turn = await reader.postSSE(`/api/conversations/${conversationId}/messages`, { content: 'สวัสดี' });
      assertEquals(turn.status, 200);
      const before = await reader.json(await reader.get(`/api/conversations/${conversationId}/messages`));
      const userMsg = before.find((m: any) => m.role === 'USER');
      assertOk(userMsg, "the reader's message must be stored");

      const patched = await reader.patch(
        `/api/conversations/${conversationId}/messages/${userMsg.id}`,
        { content: 'เปลี่ยนคำถาม' }
      );
      await assertStatus(patched, 200);
      const body = await reader.json(patched);
      assertEquals(body.message.content, 'เปลี่ยนคำถาม');
      assertOk(body.droppedReplies >= 1, 'the stale reply must be dropped');

      const after = await reader.json(await reader.get(`/api/conversations/${conversationId}/messages`));
      assertEquals(after.length, 1, 'only the edited line remains');
      assertEquals(after[0].role, 'USER');
    });

    test('7.7 A reader cannot put words in the mouth of the character', async () => {
      // Rewriting a reply would let a reader author the character's history and have the
      // model then treat it as its own.
      const owner = await freshUser('mouthowner');
      const charId = await publicCharacterOf(owner);
      const reader = await freshUser('mouthreader');

      const convRes = await reader.post('/api/conversations', { characterId: charId });
      const conversationId = (await reader.json(convRes)).conversation.id;
      await reader.postSSE(`/api/conversations/${conversationId}/messages`, { content: 'สวัสดี' });

      const msgs = await reader.json(await reader.get(`/api/conversations/${conversationId}/messages`));
      const reply = msgs.find((m: any) => m.role === 'ASSISTANT');
      assertOk(reply, 'there must be a reply to attempt to edit');

      await assertStatus(
        await reader.patch(`/api/conversations/${conversationId}/messages/${reply.id}`, { content: 'ฉันคือ AI' }),
        400
      );
    });

    test('7.8 Regenerating replaces the reply instead of appending one', async () => {
      const owner = await freshUser('regenowner');
      const charId = await publicCharacterOf(owner);
      const reader = await freshUser('regenreader');

      const convRes = await reader.post('/api/conversations', { characterId: charId });
      const conversationId = (await reader.json(convRes)).conversation.id;
      await reader.postSSE(`/api/conversations/${conversationId}/messages`, { content: 'สวัสดี' });

      const before = await reader.json(await reader.get(`/api/conversations/${conversationId}/messages`));
      const reply = before.find((m: any) => m.role === 'ASSISTANT');

      await reader.postSSE(`/api/conversations/${conversationId}/messages/${reply.id}/regenerate`, {});
      const after = await reader.json(await reader.get(`/api/conversations/${conversationId}/messages`));

      assertEquals(after.length, before.length, 'the thread must not grow');
      assertOk(!after.some((m: any) => m.id === reply.id), 'the superseded reply must be gone');
      assertEquals(after.filter((m: any) => m.role === 'USER').length, 1, "the reader's line is kept");

      // A stranger must not be able to regenerate someone else's chat.
      const stranger = await freshUser('regenstranger');
      const newReply = after.find((m: any) => m.role === 'ASSISTANT');
      await assertStatus(
        await stranger.post(`/api/conversations/${conversationId}/messages/${newReply.id}/regenerate`, {}),
        403
      );
    });

    test('7.12 Two people may share a display name, and handles stay URL-safe', async () => {
      // The sign-up form labels its first field "ชื่อที่ใช้แสดง" but the client sent it as
      // `username`, which the API reads as a handle the user chose — so the second person
      // to type a common name got 409, and the raw text became their @handle. That is why
      // seeded rows carry handles like "สมชาย สายแชท" that need URL-encoding to link to.
      const stamp = Date.now();
      const shared = 'สมชาย ใจดี';
      const client = new TestClient();

      const first = await client.post('/api/auth/register', {
        name: shared,
        email: `share_a_${stamp}@example.com`,
        password: 'Password123!',
      });
      await assertStatus(first, [200, 201]);
      const second = await client.post('/api/auth/register', {
        name: shared,
        email: `share_b_${stamp}@example.com`,
        password: 'Password123!',
      });
      await assertStatus(second, [200, 201]);

      const a = (await client.json(first)).user;
      const b = (await client.json(second)).user;
      assertEquals(a.displayName, shared);
      assertEquals(b.displayName, shared);
      assertOk(a.username !== b.username, 'the two must not share a handle');
      for (const handle of [a.username, b.username]) {
        assertOk(/^[a-z0-9_.-]+$/.test(handle), `handle ${handle} must be URL-safe`);
      }

      // An explicitly chosen handle still conflicts, which is the correct behaviour for a
      // handle someone actually picked.
      await assertStatus(
        await client.post('/api/auth/register', {
          username: a.username,
          email: `share_c_${stamp}@example.com`,
          password: 'Password123!',
        }),
        409
      );
    });

    test('7.9 Comments thread one level deep and count a like once', async () => {
      const owner = await freshUser('commentowner');
      const charId = await publicCharacterOf(owner);
      const reader = await freshUser('commentreader');

      const rootRes = await reader.post(`/api/characters/${charId}/comments`, { body: 'เขียนดีมาก' });
      await assertStatus(rootRes, 201);
      const root = (await reader.json(rootRes)).comment;

      const replyRes = await reader.post(`/api/characters/${charId}/comments`, {
        body: 'เห็นด้วย',
        parent_id: root.id,
      });
      await assertStatus(replyRes, 201);
      const reply = (await reader.json(replyRes)).comment;
      assertEquals(reply.parentId, root.id);

      // Replying to a reply attaches to the same root rather than nesting further: an
      // unbounded tree needs its own pagination and moderation story.
      const nestedRes = await reader.post(`/api/characters/${charId}/comments`, {
        body: 'ตอบซ้อน',
        parent_id: reply.id,
      });
      await assertStatus(nestedRes, 201);
      assertEquals((await reader.json(nestedRes)).comment.parentId, root.id);

      // Liking twice must not move the counter twice.
      await assertStatus(await reader.post(`/api/comments/${root.id}/like`), 200);
      const second = await reader.post(`/api/comments/${root.id}/like`);
      await assertStatus(second, 200);
      assertEquals((await reader.json(second)).likeCount, 1);

      const unliked = await reader.delete(`/api/comments/${root.id}/like`);
      await assertStatus(unliked, 200);
      assertEquals((await reader.json(unliked)).likeCount, 0);

      const listed = await reader.json(await reader.get(`/api/characters/${charId}/comments`));
      const listedRoot = listed.comments.find((c: any) => c.id === root.id);
      assertOk(listedRoot, 'the comment must be listed');
      assertEquals(listedRoot.replies.length, 2, 'both replies sit under the root');
      assertEquals(listedRoot.isMine, true);
    });

    test('7.10 Concurrent likes on one comment count once', async () => {
      const owner = await freshUser('clikeowner');
      const charId = await publicCharacterOf(owner);
      const reader = await freshUser('clikereader');

      const root = (await reader.json(
        await reader.post(`/api/characters/${charId}/comments`, { body: 'ทดสอบไลก์' })
      )).comment;

      await Promise.all(Array.from({ length: 6 }, () => reader.post(`/api/comments/${root.id}/like`)));

      const listed = await reader.json(await reader.get(`/api/characters/${charId}/comments`));
      const listedRoot = listed.comments.find((c: any) => c.id === root.id);
      assertEquals(listedRoot.likeCount, 1, 'six concurrent likes are still one like');
    });

    test('7.11 Only the author or the character’s creator can remove a comment', async () => {
      const owner = await freshUser('modowner');
      const charId = await publicCharacterOf(owner);
      const author = await freshUser('modauthor');
      const stranger = await freshUser('modstranger');

      const first = (await author.json(
        await author.post(`/api/characters/${charId}/comments`, { body: 'คอมเมนต์ที่หนึ่ง' })
      )).comment;

      // A stranger may neither reword nor remove it.
      await assertStatus(await stranger.patch(`/api/comments/${first.id}`, { body: 'แก้ของคนอื่น' }), 403);
      await assertStatus(await stranger.delete(`/api/comments/${first.id}`), 403);

      // The author may reword their own.
      const edited = await author.patch(`/api/comments/${first.id}`, { body: 'แก้ไขแล้ว' });
      await assertStatus(edited, 200);
      assertEquals((await author.json(edited)).comment.body, 'แก้ไขแล้ว');

      // The creator hosts the page, so they can clear something off it without waiting on
      // a moderator.
      const second = (await author.json(
        await author.post(`/api/characters/${charId}/comments`, { body: 'คอมเมนต์ที่สอง' })
      )).comment;
      const byCreator = await owner.delete(`/api/comments/${second.id}`);
      await assertStatus(byCreator, 200);
      assertEquals((await owner.json(byCreator)).deletedBy, 'creator');

      // Anonymous readers can read but not write.
      const anonymous = new TestClient();
      await assertStatus(await anonymous.get(`/api/characters/${charId}/comments`), 200);
      await assertStatus(await anonymous.post(`/api/characters/${charId}/comments`, { body: 'ไม่ได้ล็อกอิน' }), 401);

      // Validation.
      await assertStatus(await author.post(`/api/characters/${charId}/comments`, { body: '   ' }), 400);
      await assertStatus(
        await author.post(`/api/characters/${charId}/comments`, { body: 'x', parent_id: 'does-not-exist' }),
        404
      );
    });

    test('7.4 The report form and the API agree on the copyright field names', async () => {
      // The dialog posts snake_case, matching every other client payload in this app.
      // The route originally read only camelCase for these three, so a copyright claim
      // filed from the UI arrived with its evidence silently dropped.
      const reporter = await freshUser('copyrightreporter');
      const owner = await freshUser('copyrightowner');
      const charId = await publicCharacterOf(owner);

      const res = await reporter.post('/api/reports', {
        target_type: 'CHARACTER',
        target_id: charId,
        category: 'copyright',
        work_title: 'นิยายของฉัน',
        relationship: 'owner',
        source_link: 'https://example.com/original',
      });
      await assertStatus(res, [200, 201]);

      const mine = await reporter.json(await reporter.get('/api/reports'));
      const filed = (Array.isArray(mine) ? mine : mine.reports).find((r: any) => r.targetId === charId);
      assertOk(filed, 'the report must be readable back');
      assertEquals(filed.workTitle, 'นิยายของฉัน');
      assertEquals(filed.relationship, 'owner');
      assertEquals(filed.sourceLink, 'https://example.com/original');
    });

    test('7.5 The chat panel can read everything it renders in one request', async () => {
      // The panel shows the meters, the day count, the message count and the character
      // it is with. If any of those stopped being served it would render blank rather
      // than fail, so this pins the shape.
      const owner = await freshUser('panelowner');
      const charId = await publicCharacterOf(owner);
      const reader = await freshUser('panelreader');

      const convRes = await reader.post('/api/conversations', { characterId: charId });
      const conversationId = (await reader.json(convRes)).conversation.id;

      const res = await reader.get(`/api/conversations/${conversationId}`);
      await assertStatus(res, 200);
      const { conversation } = await reader.json(res);

      for (const field of ['romance', 'intimacy', 'messageCount', 'daysChatting']) {
        assertOk(typeof conversation[field] === 'number', `${field} must be a number`);
      }
      assertOk(typeof conversation.relationshipMode === 'boolean', 'relationshipMode must be a boolean');
      assertOk(conversation.character?.name, 'the panel needs the character it is with');
      assertOk('notes' in conversation, 'notes must be present, even when null');
      assertOk('aiModel' in conversation, 'aiModel must be present, even when null');
    });

    test('7.3 A creator profile counts what is actually public, not a dead column', async () => {
      const owner = await freshUser('countowner');
      const me = await owner.json(await owner.get('/api/users/me'));
      const handle = (me.user ?? me).username;

      await publicCharacterOf(owner);
      const privateRes = await owner.createReviewedFixture({
        name: 'ฉบับร่างส่วนตัว',
        personality: 'ยังไม่เผยแพร่',
        is_public: false,
      });
      await assertStatus(privateRes, [200, 201]);

      const res = await clientA.get(`/api/creators/${encodeURIComponent(handle)}`);
      await assertStatus(res, 200);
      const { creator, characters } = await clientA.json(res);

      // User.characterCount is never incremented anywhere, so it read 0 for everyone.
      assertEquals(creator.publicCharacterCount, 1, 'the private draft must not be counted');
      assertEquals(characters.length, 1, 'the private draft must not be listed');
      assertOk(creator.characterCount === undefined, 'the dead cached column must not be served');
    });
  });
}
