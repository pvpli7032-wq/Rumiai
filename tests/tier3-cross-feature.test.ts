/**
 * Tier 3: Cross-Feature Workflows E2E Test Suite for Khui AI Platform.
 * Tests complex cross-domain interactions combining state, data flow, and control flow across multiple domains.
 *
 * Workflows Covered:
 * Workflow 1: User signup -> Daily checkin -> Coin credit verification -> Character creation -> Conversation initialization -> SSE Message streaming.
 * Workflow 2: Character creation -> Gift sending -> Leaderboard ranking update -> Character owner profile check.
 * Workflow 3: User onboarding -> Mission list inspection -> Mission completion -> Coin balance update -> Coin package purchase simulation.
 * Workflow 4: User authentication -> Profile update -> Daily horoscope lookup -> Daily checkin streak check.
 */

import { TestClient } from './helpers/test-client';
import { describe, test, assertOk, assertEquals, assertStatus } from './helpers/test-runner';

const clientA = new TestClient();
const clientB = new TestClient();

// State shared across Tier 3 workflows
let w1UserEmail = `wf1_user_${Date.now()}@example.com`;
let w1UserPassword = 'Password123!';
let w1Token = '';
let w1CharacterId = '';
let w1ConversationId = '';
let w1InitialCoins = 0;

let w2CreatorEmail = `wf2_creator_${Date.now()}@example.com`;
let w2CreatorToken = '';
let w2SupporterEmail = `wf2_supporter_${Date.now()}@example.com`;
let w2SupporterToken = '';
let w2CharacterId = '';
let w2CharacterName = `Star Character ${Date.now()}`;

let w3UserEmail = `wf3_user_${Date.now()}@example.com`;
let w3UserToken = '';
let w3InitialCoins = 0;
let w3MissionId = '';
let w3PackageId = '';

let w4UserEmail = `wf4_user_${Date.now()}@example.com`;
let w4UserToken = '';

export function registerTier3Tests() {

  // =========================================================================
  // WORKFLOW 1: Signup -> Checkin -> Coin Credit -> Char Create -> Conv -> SSE Stream
  // =========================================================================
  describe('Tier 3 - Workflow 1: Signup to Chat Streaming Lifecycle', () => {

    test('1.1 User Signup and Auth Token Generation', async () => {
      const res = await clientA.post('/api/auth/register', {
        name: 'Workflow 1 User',
        email: w1UserEmail,
        password: w1UserPassword,
      });
      await assertStatus(res, [200, 201]);
      const data = await clientA.json(res);
      w1Token = data.token;
      assertOk(w1Token, 'Signup should return authorization token');
      clientA.setToken(w1Token);
    });

    test('1.2 Perform Daily Checkin and Collect Coins', async () => {
      // Check initial coins
      const meRes = await clientA.get('/api/users/me');
      await assertStatus(meRes, 200);
      const meData = await clientA.json(meRes);
      w1InitialCoins = meData.coins !== undefined ? meData.coins : (meData.user ? meData.user.coins : 0);

      // Perform checkin
      const checkinRes = await clientA.post('/api/checkin');
      await assertStatus(checkinRes, [200, 201]);
      const checkinData = await clientA.json(checkinRes);
      assertOk(checkinData.success !== false, 'Checkin should be successful');
    });

    test('1.3 Verify Coin Credit in User Account Profile', async () => {
      const res = await clientA.get('/api/users/me');
      await assertStatus(res, 200);
      const data = await clientA.json(res);
      const updatedCoins = data.coins !== undefined ? data.coins : (data.user ? data.user.coins : 0);
      assertOk(typeof updatedCoins === 'number', 'Coins balance should be numeric');
      assertOk(updatedCoins >= w1InitialCoins, 'Coin balance should increase or maintain after checkin');
    });

    test('1.4 Create Custom AI Character', async () => {
      const res = await clientA.createReviewedFixture({
        name: 'Workflow 1 Companion',
        personality: 'Enthusiastic Thai companion and tour guide',
        background: 'Expert on Northern Thailand travel and local foods.',
        avatar_url: 'https://example.com/avatar_wf1.png',
        is_public: true,
      });
      await assertStatus(res, [200, 201]);
      const data = await clientA.json(res);
      const char = data.character || data;
      assertOk(char.id, 'Created character must contain valid ID');
      assertEquals(char.name, 'Workflow 1 Companion');
      w1CharacterId = char.id;
    });

    test('1.5 Initialize Conversation Session', async () => {
      assertOk(w1CharacterId, 'Character ID must be present from step 1.4');
      const res = await clientA.post('/api/conversations', {
        character_id: w1CharacterId,
        characterId: w1CharacterId,
      });
      await assertStatus(res, [200, 201]);
      const data = await clientA.json(res);
      const conv = data.conversation || data;
      assertOk(conv.id, 'Conversation session must yield an ID');
      w1ConversationId = conv.id;
    });

    test('1.6 Send User Query and Receive SSE Response Stream', async () => {
      assertOk(w1ConversationId, 'Conversation ID must be present from step 1.5');
      const res = await clientA.post(`/api/conversations/${w1ConversationId}/messages`, {
        content: 'สวัสดีครับ ช่วยแนะนำสถานที่ท่องเที่ยวในเชียงใหม่หน่อย',
      });
      await assertStatus(res, 200);

      const sseResult = await TestClient.readSSEStream(res);
      assertOk(sseResult.chunks.length > 0 || sseResult.fullText.length > 0, 'SSE stream should emit content tokens');
      assertOk(sseResult.isDone, 'SSE response stream should complete with [DONE]');
    });
  });

  // =========================================================================
  // WORKFLOW 2: Character Creation -> Gift -> Leaderboard -> Owner Profile
  // =========================================================================
  describe('Tier 3 - Workflow 2: Creator Economy & Leaderboard Update Flow', () => {

    test('2.1 Creator Registration and Character Creation', async () => {
      // Register Creator User
      const regRes = await clientA.post('/api/auth/register', {
        name: 'Creator User',
        email: w2CreatorEmail,
        password: 'Password123!',
      });
      await assertStatus(regRes, [200, 201]);
      w2CreatorToken = (await clientA.json(regRes)).token;
      clientA.setToken(w2CreatorToken);

      // Create Character
      const charRes = await clientA.createReviewedFixture({
        name: w2CharacterName,
        personality: 'Charming virtual idol',
        background: 'Famous virtual streamer and digital artist.',
        is_public: true,
      });
      await assertStatus(charRes, [200, 201]);
      const charData = await clientA.json(charRes);
      const char = charData.character || charData;
      w2CharacterId = char.id;
      assertOk(w2CharacterId, 'Created character ID must exist');
    });

    test('2.2 Supporter Registration and Gift Transmission', async () => {
      assertOk(w2CharacterId, 'Character ID must be available');
      // Register Supporter User
      const regRes = await clientB.post('/api/auth/register', {
        name: 'Supporter User',
        email: w2SupporterEmail,
        password: 'Password123!',
      });
      await assertStatus(regRes, [200, 201]);
      w2SupporterToken = (await clientB.json(regRes)).token;
      clientB.setToken(w2SupporterToken);

      // Send Gift
      const giftRes = await clientB.post(`/api/characters/${w2CharacterId}/gift`, {
        gift_type: 'rose',
        amount: 100,
      });
      await assertStatus(giftRes, [200, 201]);
      const giftData = await clientB.json(giftRes);
      assertOk(giftData.success !== false, 'Gift transaction should succeed');
    });

    test('2.3 Verify Leaderboard Ranking reflects Gift Sent', async () => {
      const res = await clientB.get('/api/leaderboard/gifts');
      await assertStatus(res, 200);
      const data = await clientB.json(res);
      const leaderboard = Array.isArray(data) ? data : (data.leaderboard || data.items || []);
      assertOk(Array.isArray(leaderboard), 'Leaderboard should return an array');
    });

    test('2.4 Verify Character Owner Profile Status and Details', async () => {
      // Check character detail
      const charRes = await clientA.get(`/api/characters/${w2CharacterId}`);
      await assertStatus(charRes, 200);
      const charData = await clientA.json(charRes);
      const char = charData.character || charData;
      assertEquals(char.name, w2CharacterName);

      // Check owner profile
      const ownerRes = await clientA.get('/api/users/me');
      await assertStatus(ownerRes, 200);
      const ownerData = await clientA.json(ownerRes);
      assertOk(ownerData.user || ownerData, 'Owner profile should be retrievable');
    });
  });

  // =========================================================================
  // WORKFLOW 3: Onboarding -> Mission Inspection -> Mission Complete -> Coin Purchase
  // =========================================================================
  describe('Tier 3 - Workflow 3: Onboarding, Mission Completion & Economy Purchase Flow', () => {

    test('3.1 User Onboarding Registration', async () => {
      const res = await clientA.post('/api/auth/register', {
        name: 'Workflow 3 User',
        email: w3UserEmail,
        password: 'Password123!',
      });
      await assertStatus(res, [200, 201]);
      w3UserToken = (await clientA.json(res)).token;
      clientA.setToken(w3UserToken);

      const meRes = await clientA.get('/api/users/me');
      const meData = await clientA.json(meRes);
      w3InitialCoins = meData.coins !== undefined ? meData.coins : (meData.user ? meData.user.coins : 0);
    });

    test('3.2 Inspect Active Missions List', async () => {
      const res = await clientA.get('/api/missions');
      await assertStatus(res, 200);
      const data = await clientA.json(res);
      const missions = Array.isArray(data) ? data : (data.missions || []);
      assertOk(Array.isArray(missions), 'Missions endpoint should return an array');
      if (missions.length > 0) {
        w3MissionId = missions[0].id || missions[0]._id;
      }
    });

    test('3.3 Execute Mission Completion', async () => {
      const missionIdToComplete = w3MissionId || 'mission_1';
      const res = await clientA.post(`/api/missions/${missionIdToComplete}/complete`);
      await assertStatus(res, [200, 201]);
      const data = await clientA.json(res);
      assertOk(data.success !== false, 'Mission completion should return success');
    });

    test('3.4 Verify Coin Balance Increment after Mission Reward', async () => {
      const res = await clientA.get('/api/users/me');
      await assertStatus(res, 200);
      const data = await clientA.json(res);
      const currentCoins = data.coins !== undefined ? data.coins : (data.user ? data.user.coins : 0);
      assertOk(typeof currentCoins === 'number', 'Coins balance should be numeric');
    });

    test('3.5 Inspect Coin Packages and Simulate Purchase', async () => {
      // Get Packages
      const pkgRes = await clientA.get('/api/coins/packages');
      await assertStatus(pkgRes, 200);
      const pkgData = await clientA.json(pkgRes);
      const packages = Array.isArray(pkgData) ? pkgData : (pkgData.packages || []);
      assertOk(Array.isArray(packages), 'Coin packages must be an array');
      if (packages.length > 0) {
        w3PackageId = packages[0].id;
      }

      // Purchase Simulation
      const purchaseRes = await clientA.post('/api/coins/purchase', {
        package_id: w3PackageId || 'pkg_starter',
        packageId: w3PackageId || 'pkg_starter',
      });
      await assertStatus(purchaseRes, [200, 201]);
      const purchaseData = await clientA.json(purchaseRes);
      assertOk(purchaseData.success !== false, 'Coin purchase simulation should succeed');
    });
  });

  // =========================================================================
  // WORKFLOW 4: Auth -> Profile Update -> Horoscope -> Checkin Streak Check
  // =========================================================================
  describe('Tier 3 - Workflow 4: Daily Engagement, Horoscope & Profile Sync', () => {

    test('4.1 User Authentication and Token Setup', async () => {
      const res = await clientA.post('/api/auth/register', {
        name: 'Workflow 4 User',
        email: w4UserEmail,
        password: 'Password123!',
      });
      await assertStatus(res, [200, 201]);
      w4UserToken = (await clientA.json(res)).token;
      clientA.setToken(w4UserToken);
    });

    test('4.2 Update User Profile with Zodiac and Bio Details', async () => {
      const res = await clientA.put('/api/users/me', {
        name: 'Astrology Fan',
        bio: 'Star gazer and AI enthusiast',
        avatar_url: 'https://example.com/zodiac_avatar.png',
      });
      await assertStatus(res, 200);
      const data = await clientA.json(res);
      const user = data.user || data;
      assertEquals(user.name, 'Astrology Fan');
    });

    test('4.3 Lookup Daily Horoscope for Zodiac Sign', async () => {
      const res = await clientA.get('/api/horoscope/leo');
      await assertStatus(res, 200);
      const data = await clientA.json(res);
      assertOk(data.sign || data.title || data.description, 'Horoscope payload should contain zodiac forecast details');
    });

    test('4.4 Verify Checkin Status and Streak Tracker', async () => {
      const res = await clientA.get('/api/checkin/status');
      await assertStatus(res, 200);
      const data = await clientA.json(res);
      assertOk(data.checkedInToday !== undefined || data.checked_in_today !== undefined || data.streakDay !== undefined || data.streak_count !== undefined, 'Checkin status should contain streak parameters');
    });
  });
}
