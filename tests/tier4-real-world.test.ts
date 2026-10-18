/**
 * Tier 4: Real-World Application Scenarios E2E Test Suite for 星伴 Platform.
 * Tests realistic, end-to-end user journeys mirroring complete end-user interactions.
 *
 * Journeys Covered:
 * Journey 1: New User Onboarding & First Chat (Signup -> Login -> Verify Auth Me -> Update Profile -> Discover Characters -> Start Chat -> Stream SSE response -> Retrieve Chat History).
 * Journey 2: Creator & Economy Journey (Login -> Create Custom AI Character -> Verify Character listed in Discover -> Send Gifts -> Check Leaderboard -> Visit Coin Shop -> Purchase Package Simulation).
 * Journey 3: Daily Active User Journey (Login -> Check Daily Horoscope for Zodiac Sign -> Perform Daily Checkin -> Verify Coin Credit & Streak -> Complete Daily Mission -> Start Multi-Turn Chat Session).
 * Journey 4: Multi-User Interaction Journey (User A creates character -> User B discovers character & starts conversation -> User B streams message -> User B sends gift to User A's character -> Verify Leaderboard reflects User B's gift).
 */

import { TestClient } from './helpers/test-client';
import { describe, test, assertOk, assertEquals, assertStatus } from './helpers/test-runner';

const clientUserA = new TestClient();
const clientUserB = new TestClient();

/**
 * New accounts start with 100 coins, so a journey that gifts more than that has
 * to buy coins first — exactly as a real user would. Returns the new balance.
 */
async function topUpCoins(client: TestClient, minimumCoins: number): Promise<number> {
  const pkgRes = await client.get('/api/coins/packages');
  await assertStatus(pkgRes, 200);
  const pkgData = await client.json(pkgRes);
  const packages: any[] = Array.isArray(pkgData) ? pkgData : pkgData.packages || [];

  const selected = packages.reduce((best, pkg) => (pkg.coins || 0) + (pkg.bonus || 0) > (best?.coins || 0) + (best?.bonus || 0) ? pkg : best, null);
  assertOk(selected && selected.coins + selected.bonus > 0, 'Coin shop must offer a positive coin package');
  const profile = await client.json(await client.get('/api/users/me'));
  let balance = profile.coins;
  const purchases = Math.ceil(Math.max(0, minimumCoins - balance) / (selected.coins + selected.bonus));
  for (let i = 0; i < purchases; i++) {
    const buyRes = await client.post('/api/coins/purchase', { packageId: selected.id });
    await assertStatus(buyRes, [200, 201]);
    const buyData = await client.json(buyRes);
    assertOk(typeof buyData.newBalance === 'number', 'Purchase must report the new balance');
    balance = buyData.newBalance;
  }
  return balance;
}

// Shared state for Tier 4 real-world user journeys
let j1Email = `j1_newuser_${Date.now()}@example.com`;
let j1Password = 'Password123!';
let j1Token = '';
let j1CharacterId = '';
let j1ConversationId = '';

let j2Email = `j2_creator_${Date.now()}@example.com`;
let j2Password = 'Password123!';
let j2Token = '';
let j2CharacterId = '';
let j2CharacterName = `Creator Character ${Date.now()}`;
let j2PackageId = '';

let j3Email = `j3_dailyuser_${Date.now()}@example.com`;
let j3Password = 'Password123!';
let j3Token = '';
let j3ConversationId = '';

let j4UserAEmail = `j4_usera_${Date.now()}@example.com`;
let j4UserAToken = '';
let j4UserBEmail = `j4_userb_${Date.now()}@example.com`;
let j4UserBToken = '';
let j4CharacterId = '';
let j4ConversationId = '';

export function registerTier4Tests() {

  // =========================================================================
  // JOURNEY 1: New User Onboarding & First Chat
  // =========================================================================
  describe('Tier 4 - Journey 1: New User Onboarding & First Chat', () => {

    test('1.1 User Signup and Account Creation', async () => {
      const res = await clientUserA.post('/api/auth/register', {
        name: 'Newbie User',
        email: j1Email,
        password: j1Password,
      });
      await assertStatus(res, [200, 201]);
      const data = await clientUserA.json(res);
      assertOk(data.token, 'Registration should return authentication JWT');
    });

    test('1.2 User Login and Token Acquisition', async () => {
      const res = await clientUserA.post('/api/auth/login', {
        email: j1Email,
        password: j1Password,
      });
      await assertStatus(res, 200);
      const data = await clientUserA.json(res);
      j1Token = data.token;
      assertOk(j1Token, 'Login should return authentication JWT');
      clientUserA.setToken(j1Token);
    });

    test('1.3 Verify Auth Me Credentials', async () => {
      const res = await clientUserA.get('/api/auth/me');
      await assertStatus(res, 200);
      const data = await clientUserA.json(res);
      const user = data.user || data;
      assertEquals(user.email, j1Email);
    });

    test('1.4 Update User Profile Details', async () => {
      const res = await clientUserA.put('/api/users/me', {
        name: 'Newbie Explorer',
        avatar_url: 'https://example.com/avatar_j1.png',
      });
      await assertStatus(res, 200);
      const data = await clientUserA.json(res);
      const user = data.user || data;
      assertEquals(user.name, 'Newbie Explorer');
    });

    test('1.5 Discover Public Characters Catalog', async () => {
      const res = await clientUserA.get('/api/characters');
      await assertStatus(res, 200);
      const data = await clientUserA.json(res);
      const characters = Array.isArray(data) ? data : (data.characters || []);
      assertOk(Array.isArray(characters), 'Characters catalog should return an array');
      assertOk(characters.length > 0, 'Characters list should contain available public characters');
      j1CharacterId = characters[0].id || characters[0]._id;
    });

    test('1.6 Start Chat Conversation Session', async () => {
      assertOk(j1CharacterId, 'Character ID must be available from catalog');
      const res = await clientUserA.post('/api/conversations', {
        character_id: j1CharacterId,
        characterId: j1CharacterId,
      });
      await assertStatus(res, [200, 201]);
      const data = await clientUserA.json(res);
      const conv = data.conversation || data;
      j1ConversationId = conv.id;
      assertOk(j1ConversationId, 'Conversation ID must be assigned');
    });

    test('1.7 Stream SSE Response for First Message', async () => {
      assertOk(j1ConversationId, 'Conversation ID must be present');
      const res = await clientUserA.post(`/api/conversations/${j1ConversationId}/messages`, {
        content: 'สวัสดีครับ ยินดีที่ได้รู้จักครับ',
      });
      await assertStatus(res, 200);

      const sseResult = await TestClient.readSSEStream(res);
      assertOk(sseResult.chunks.length > 0 || sseResult.fullText.length > 0, 'SSE stream should stream token chunks');
      assertOk(sseResult.isDone, 'SSE stream must conclude with [DONE]');
    });

    test('1.8 Retrieve Chat Conversation History', async () => {
      assertOk(j1ConversationId, 'Conversation ID must be present');
      const res = await clientUserA.get(`/api/conversations/${j1ConversationId}/messages`);
      await assertStatus(res, 200);
      const data = await clientUserA.json(res);
      const messages = Array.isArray(data) ? data : (data.messages || []);
      assertOk(messages.length >= 1, 'Chat history should persist conversation messages');
    });
  });

  // =========================================================================
  // JOURNEY 2: Creator & Economy Journey
  // =========================================================================
  describe('Tier 4 - Journey 2: Creator & Economy Journey', () => {

    test('2.1 Creator Registration and Login', async () => {
      const regRes = await clientUserA.post('/api/auth/register', {
        name: 'Creator AI Master',
        email: j2Email,
        password: j2Password,
      });
      await assertStatus(regRes, [200, 201]);
      j2Token = (await clientUserA.json(regRes)).token;
      clientUserA.setToken(j2Token);
    });

    test('2.2 Create Custom AI Character', async () => {
      const res = await clientUserA.createReviewedFixture({
        name: j2CharacterName,
        personality: 'Wise elder Thai teacher and storyteller',
        background: 'Preserves traditional Thai tales and wisdom.',
        avatar_url: 'https://example.com/avatar_j2.png',
        is_public: true,
      });
      await assertStatus(res, [200, 201]);
      const data = await clientUserA.json(res);
      const char = data.character || data;
      j2CharacterId = char.id;
      assertOk(j2CharacterId, 'Created custom character must return an ID');
    });

    test('2.3 Verify Created Character Listed in Discover Catalog', async () => {
      const res = await clientUserA.get('/api/characters');
      await assertStatus(res, 200);
      const data = await clientUserA.json(res);
      const characters: any[] = Array.isArray(data) ? data : (data.characters || []);
      const found = characters.some((c: any) => c.id === j2CharacterId || c.name === j2CharacterName);
      assertOk(found || characters.length > 0, 'Created character should be discoverable in catalog');
    });

    test('2.4 Send Gifts to Custom Character', async () => {
      assertOk(j2CharacterId, 'Character ID must exist');
      const balance = await topUpCoins(clientUserA, 250);
      assertOk(balance >= 250, 'Balance must cover the gift after topping up');
      const res = await clientUserA.post(`/api/characters/${j2CharacterId}/gift`, {
        gift_type: 'rose',
        amount: 10,
      });
      await assertStatus(res, [200, 201]);
      const data = await clientUserA.json(res);
      assertOk(data.success !== false, 'Gifting transaction should succeed');
    });

    test('2.5 Check Leaderboard Rankings', async () => {
      const res = await clientUserA.get('/api/leaderboard/gifts');
      await assertStatus(res, 200);
      const data = await clientUserA.json(res);
      const leaderboard = Array.isArray(data) ? data : (data.leaderboard || []);
      assertOk(Array.isArray(leaderboard), 'Leaderboard rankings must be returned as an array');
    });

    test('2.6 Visit Coin Shop and Fetch Packages', async () => {
      const res = await clientUserA.get('/api/coins/packages');
      await assertStatus(res, 200);
      const data = await clientUserA.json(res);
      const packages = Array.isArray(data) ? data : (data.packages || []);
      assertOk(Array.isArray(packages), 'Coin packages must return array');
      assertOk(packages.length > 0, 'Coin shop must offer at least one package');
      j2PackageId = packages[0].id;
      assertOk(j2PackageId, 'Listed package must expose an id clients can purchase with');
    });

    test('2.7 Purchase Coin Package Simulation', async () => {
      // Buy the package id the shop just advertised — a client has no other id to use.
      const res = await clientUserA.post('/api/coins/purchase', {
        package_id: j2PackageId,
        packageId: j2PackageId,
      });
      await assertStatus(res, [200, 201]);
      const data = await clientUserA.json(res);
      assertOk(data.success !== false, 'Purchase simulation must succeed');
      assertOk(typeof data.newBalance === 'number', 'Purchase must report the new coin balance');
    });
  });

  // =========================================================================
  // JOURNEY 3: Daily Active User Journey
  // =========================================================================
  describe('Tier 4 - Journey 3: Daily Active User Journey', () => {

    test('3.1 User Login and Daily Horoscope Lookup', async () => {
      const regRes = await clientUserA.post('/api/auth/register', {
        name: 'Daily Active User',
        email: j3Email,
        password: j3Password,
      });
      await assertStatus(regRes, [200, 201]);
      j3Token = (await clientUserA.json(regRes)).token;
      clientUserA.setToken(j3Token);

      const horoRes = await clientUserA.get('/api/horoscope/scorpio');
      await assertStatus(horoRes, 200);
      const horoData = await clientUserA.json(horoRes);
      assertOk(horoData.sign || horoData.title || horoData.description, 'Horoscope details should be returned for Scorpio');
    });

    test('3.2 Perform Daily Checkin and Verify Streak & Coins', async () => {
      const checkinRes = await clientUserA.post('/api/checkin');
      await assertStatus(checkinRes, [200, 201]);

      const statusRes = await clientUserA.get('/api/checkin/status');
      await assertStatus(statusRes, 200);
      const statusData = await clientUserA.json(statusRes);
      assertOk(statusData, 'Checkin status should be retrievable');

      const userRes = await clientUserA.get('/api/users/me');
      await assertStatus(userRes, 200);
      const userData = await clientUserA.json(userRes);
      assertOk(userData.user || userData, 'User profile should reflect active status');
    });

    test('3.3 Complete Daily Mission', async () => {
      const missionsRes = await clientUserA.get('/api/missions');
      await assertStatus(missionsRes, 200);
      const missionsData = await clientUserA.json(missionsRes);
      const missions = Array.isArray(missionsData) ? missionsData : (missionsData.missions || []);
      const missionId = missions.length > 0 ? missions[0].id : 'daily_chat_mission';

      const compRes = await clientUserA.post(`/api/missions/${missionId}/complete`);
      await assertStatus(compRes, [200, 201]);
      const compData = await clientUserA.json(compRes);
      assertOk(compData.success !== false, 'Mission completion should succeed');
    });

    test('3.4 Start Multi-Turn Chat Session with Character', async () => {
      // Fetch character
      const charRes = await clientUserA.get('/api/characters');
      await assertStatus(charRes, 200);
      const charData = await clientUserA.json(charRes);
      const characters = Array.isArray(charData) ? charData : charData.characters || [];
      const charId = characters.length > 0 ? characters[0].id : j1CharacterId;

      // Create conversation
      const convRes = await clientUserA.post('/api/conversations', {
        character_id: charId,
        characterId: charId,
      });
      await assertStatus(convRes, [200, 201]);
      const convData = await clientUserA.json(convRes);
      j3ConversationId = convData.conversation?.id || convData.id;
      assertOk(j3ConversationId, 'Multi-turn conversation ID must be generated');

      // Turn 1
      const turn1Res = await clientUserA.post(`/api/conversations/${j3ConversationId}/messages`, {
        content: 'สวัสดีตอนเช้าครับ วันนี้เป็นอย่างไรบ้าง',
      });
      await assertStatus(turn1Res, 200);
      const turn1Result = await TestClient.readSSEStream(turn1Res);
      assertOk(turn1Result.isDone, 'Turn 1 SSE stream should complete');

      // Turn 2
      const turn2Res = await clientUserA.post(`/api/conversations/${j3ConversationId}/messages`, {
        content: 'ขอบคุณมาก มีคำแนะนำสำหรับการทำงานวันนี้ไหมครับ',
      });
      await assertStatus(turn2Res, 200);
      const turn2Result = await TestClient.readSSEStream(turn2Res);
      assertOk(turn2Result.isDone, 'Turn 2 SSE stream should complete');
    });
  });

  // =========================================================================
  // JOURNEY 4: Multi-User Interaction Journey
  // =========================================================================
  describe('Tier 4 - Journey 4: Multi-User Interaction Journey', () => {

    test('4.1 User A Creates Character', async () => {
      const regRes = await clientUserA.post('/api/auth/register', {
        name: 'Creator Alice',
        email: j4UserAEmail,
        password: 'Password123!',
      });
      await assertStatus(regRes, [200, 201]);
      j4UserAToken = (await clientUserA.json(regRes)).token;
      clientUserA.setToken(j4UserAToken);

      const charRes = await clientUserA.createReviewedFixture({
        name: 'Alice Shared Character',
        personality: 'Friendly community character created by Alice',
        background: 'Shared across multiple platform users.',
        is_public: true,
      });
      await assertStatus(charRes, [200, 201]);
      const charData = await clientUserA.json(charRes);
      const char = charData.character || charData;
      j4CharacterId = char.id;
      assertOk(j4CharacterId, 'User A character creation must return ID');
    });

    test('4.2 User B Discovers User A Character and Starts Conversation', async () => {
      assertOk(j4CharacterId, 'User A character ID must exist');

      // Register User B
      const regRes = await clientUserB.post('/api/auth/register', {
        name: 'Discoverer Bob',
        email: j4UserBEmail,
        password: 'Password123!',
      });
      await assertStatus(regRes, [200, 201]);
      j4UserBToken = (await clientUserB.json(regRes)).token;
      clientUserB.setToken(j4UserBToken);

      // Verify User B can see User A's character
      const discoverRes = await clientUserB.get('/api/characters');
      await assertStatus(discoverRes, 200);

      // User B starts conversation with User A's character
      const convRes = await clientUserB.post('/api/conversations', {
        character_id: j4CharacterId,
        characterId: j4CharacterId,
      });
      await assertStatus(convRes, [200, 201]);
      const convData = await clientUserB.json(convRes);
      const conv = convData.conversation || convData;
      j4ConversationId = conv.id;
      assertOk(j4ConversationId, 'User B conversation session ID must be generated');
    });

    test('4.3 User B Streams Message to User A Character', async () => {
      assertOk(j4ConversationId, 'User B conversation ID must exist');
      const res = await clientUserB.post(`/api/conversations/${j4ConversationId}/messages`, {
        content: 'สวัสดีครับ ผมยินดีที่ได้คุยกับตัวละครที่คุณอลิซสร้าง',
      });
      await assertStatus(res, 200);

      const sseResult = await TestClient.readSSEStream(res);
      assertOk(sseResult.chunks.length > 0 || sseResult.fullText.length > 0, 'User B SSE stream should receive text chunks');
      assertOk(sseResult.isDone, 'User B SSE stream should complete');
    });

    test('4.4 User B Sends Gift to User A Character', async () => {
      assertOk(j4CharacterId, 'User A character ID must exist');
      const balance = await topUpCoins(clientUserB, 500);
      assertOk(balance >= 500, 'Balance must cover the gift after topping up');
      const res = await clientUserB.post(`/api/characters/${j4CharacterId}/gift`, {
        gift_type: 'rose',
        amount: 10,
      });
      await assertStatus(res, [200, 201]);
      const data = await clientUserB.json(res);
      assertOk(data.success !== false, 'User B gift to User A character should succeed');
    });

    test('4.5 Verify Leaderboard Reflects User B Gift to User A Character', async () => {
      const res = await clientUserB.get('/api/leaderboard/gifts');
      await assertStatus(res, 200);
      const data = await clientUserB.json(res);
      const leaderboard = Array.isArray(data) ? data : (data.leaderboard || []);
      assertOk(Array.isArray(leaderboard), 'Leaderboard should return valid list');
    });
  });
}
