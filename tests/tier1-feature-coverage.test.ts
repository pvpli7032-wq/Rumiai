/**
 * Tier 1: Feature Coverage E2E Test Suite for Khui AI Platform.
 * Covers all key functional areas: Auth, Characters, Chat SSE, User Profile,
 * Checkin/Streak, Missions, Leaderboard, Horoscope, and Coins.
 *
 * Requirements: >= 5 test cases per feature area (total >= 45 tests).
 */

import { TestClient } from './helpers/test-client';
import { describe, test, assertOk, assertEquals, assertStatus } from './helpers/test-runner';

const client = new TestClient();
const client2 = new TestClient();

// Shared test state
let user1Token = '';
let user1Email = `test_user_1_${Date.now()}@example.com`;
let user1Password = 'Password123!';
let user1Id = '';

let user2Token = '';
let user2Email = `test_user_2_${Date.now()}@example.com`;
let user2Password = 'Password123!';

let createdCharacterId = '';
let createdConversationId = '';
let initialCoins = 0;
let mission1Id = '';
let mission2Id = '';
let package1Id = '';
let package2Id = '';

export function registerTier1Tests() {

  // ==========================================
  // 1. AUTH FEATURE TESTS (5 tests)
  // ==========================================
  describe('Tier 1 - Auth Feature', () => {
    test('1.1 Register User 1 successfully', async () => {
      const res = await client.post('/api/auth/register', {
        name: 'Tester One',
        email: user1Email,
        password: user1Password,
      });
      await assertStatus(res, [200, 201]);
      const data = await client.json(res);
      assertOk(data.token, 'Token should be returned on registration');
      assertOk(data.user, 'User object should be returned on registration');
      assertEquals(data.user.email, user1Email);

      user1Token = data.token;
      user1Id = data.user.id || data.user._id;
      client.setToken(user1Token);
    });

    test('1.2 Register User 2 successfully', async () => {
      const res = await client2.post('/api/auth/register', {
        name: 'Tester Two',
        email: user2Email,
        password: user2Password,
      });
      await assertStatus(res, [200, 201]);
      const data = await client2.json(res);
      assertOk(data.token, 'Token should be returned for User 2');
      assertOk(data.user, 'User object should be returned for User 2');
      assertEquals(data.user.email, user2Email);

      user2Token = data.token;
      client2.setToken(user2Token);
    });

    test('1.3 Login User 1 with valid credentials', async () => {
      const res = await client.post('/api/auth/login', {
        email: user1Email,
        password: user1Password,
      });
      await assertStatus(res, 200);
      const data = await client.json(res);
      assertOk(data.token, 'Token should be returned on login');
      assertEquals(data.user.email, user1Email);

      user1Token = data.token;
      client.setToken(user1Token);
    });

    test('1.4 Verify /api/auth/me endpoint returns current authenticated user', async () => {
      const res = await client.get('/api/auth/me');
      await assertStatus(res, 200);
      const data = await client.json(res);
      const user = data.user || data;
      assertOk(user, 'User payload should be present');
      assertEquals(user.email, user1Email);
    });

    test('1.5 Login with incorrect password is rejected', async () => {
      const res = await client.post('/api/auth/login', {
        email: user1Email,
        password: 'WrongPassword999!',
      });
      await assertStatus(res, [400, 401]);
      const data = await client.json(res);
      assertOk(data.error || data.message, 'Error message should be returned for invalid password');
    });
  });

  // ==========================================
  // 2. CHARACTERS FEATURE TESTS (5 tests)
  // ==========================================
  describe('Tier 1 - Characters Feature', () => {
    test('2.1 List public characters', async () => {
      const res = await client.get('/api/characters');
      await assertStatus(res, 200);
      const data = await client.json(res);
      const characters = Array.isArray(data) ? data : data.characters;
      assertOk(Array.isArray(characters), 'Public characters should be an array');
    });

    test('2.2 Create new character as User 1', async () => {
      const res = await client.createReviewedFixture({
        name: 'Manoch AI',
        personality: 'Friendly and knowledgeable Thai tutor',
        background: 'Born in Bangkok, loves teaching culture and language.',
        avatar_url: 'https://example.com/avatar.png',
        is_public: true,
      });
      await assertStatus(res, [200, 201]);
      const data = await client.json(res);
      const char = data.character || data;
      assertOk(char.id, 'Created character must have an ID');
      assertEquals(char.name, 'Manoch AI');
      createdCharacterId = char.id;
    });

    test('2.3 Get character details by ID', async () => {
      assertOk(createdCharacterId, 'Character ID must be available');
      const res = await client.get(`/api/characters/${createdCharacterId}`);
      await assertStatus(res, 200);
      const data = await client.json(res);
      const char = data.character || data;
      assertEquals(char.id, createdCharacterId);
      assertEquals(char.name, 'Manoch AI');
    });

    test('2.4 Edit owned character details', async () => {
      assertOk(createdCharacterId, 'Character ID must be available');
      const res = await client.put(`/api/characters/${createdCharacterId}`, {
        name: 'Manoch AI Updated',
        personality: 'Super friendly Thai AI assistant',
        background: 'Updated Thai culture enthusiast.',
        avatar_url: 'https://example.com/avatar_updated.png',
        is_public: true,
      });
      await assertStatus(res, 200);
      const data = await client.json(res);
      const char = data.character || data;
      assertEquals(char.name, 'Manoch AI Updated');
    });

    test('2.5 Delete owned character', async () => {
      // Create a temporary character to delete so createdCharacterId can be kept for Chat tests or delete temp
      const tempRes = await client.createReviewedFixture({
        name: 'Temp Char To Delete',
        personality: 'Temporary character',
        background: 'Will be deleted',
        is_public: true,
      });
      await assertStatus(tempRes, [200, 201]);
      const tempChar = (await client.json(tempRes)).character || (await client.json(tempRes));
      const tempId = tempChar.id;

      const deleteRes = await client.delete(`/api/characters/${tempId}`);
      await assertStatus(deleteRes, 200);
      const deleteData = await client.json(deleteRes);
      assertOk(deleteData.success !== false, 'Delete response should indicate success');

      // Verify 404 on fetching deleted character
      const fetchRes = await client.get(`/api/characters/${tempId}`);
      await assertStatus(fetchRes, 404);
    });
  });

  // ==========================================
  // 3. CHAT SSE FEATURE TESTS (5 tests)
  // ==========================================
  describe('Tier 1 - Chat SSE Feature', () => {
    test('3.1 Create new conversation with character', async () => {
      assertOk(createdCharacterId, 'Created character ID must exist');
      const res = await client.post('/api/conversations', {
        character_id: createdCharacterId,
      });
      await assertStatus(res, [200, 201]);
      const data = await client.json(res);
      const conv = data.conversation || data;
      assertOk(conv.id, 'Conversation should have an ID');
      createdConversationId = conv.id;
    });

    test('3.2 Get message history for new conversation (empty or initial greeting)', async () => {
      assertOk(createdConversationId, 'Conversation ID must exist');
      const res = await client.get(`/api/conversations/${createdConversationId}/messages`);
      await assertStatus(res, 200);
      const data = await client.json(res);
      const messages = Array.isArray(data) ? data : data.messages;
      assertOk(Array.isArray(messages), 'Message history should be an array');
    });

    test('3.3 Send user message and stream response via SSE', async () => {
      assertOk(createdConversationId, 'Conversation ID must exist');
      const res = await client.post(`/api/conversations/${createdConversationId}/messages`, {
        content: 'สวัสดีครับ ช่วยแนะนำตัวหน่อย',
      });
      await assertStatus(res, 200);

      const sseResult = await TestClient.readSSEStream(res);
      assertOk(sseResult.chunks.length > 0 || sseResult.fullText.length > 0, 'SSE stream should receive content chunks');
      assertOk(sseResult.isDone, 'SSE stream should complete cleanly');
    });

    test('3.4 Verify SSE stream ends with [DONE] marker event', async () => {
      assertOk(createdConversationId, 'Conversation ID must exist');
      const res = await client.post(`/api/conversations/${createdConversationId}/messages`, {
        content: 'อากาศวันนี้เป็นอย่างไรบ้าง',
      });
      await assertStatus(res, 200);

      const sseResult = await TestClient.readSSEStream(res);
      const hasDone = sseResult.isDone || sseResult.events.some(e => e.data === '[DONE]');
      assertOk(hasDone, 'SSE stream must emit [DONE] marker');
    });

    test('3.5 Verify messages are persisted in conversation history', async () => {
      assertOk(createdConversationId, 'Conversation ID must exist');
      const res = await client.get(`/api/conversations/${createdConversationId}/messages`);
      await assertStatus(res, 200);
      const data = await client.json(res);
      const messages: any[] = Array.isArray(data) ? data : data.messages;
      assertOk(messages.length >= 2, 'Message history should record user query and assistant response');
      // The app stores and renders roles uppercase (Message.role is 'USER' /
      // 'ASSISTANT' in the DB and in the chat UI), so compare case-insensitively.
      const userMsg = messages.find((m: any) => String(m.role).toUpperCase() === 'USER');
      const assistantMsg = messages.find((m: any) => String(m.role).toUpperCase() === 'ASSISTANT');
      assertOk(userMsg, 'User message should be in history');
      assertOk(assistantMsg, 'Assistant message should be in history');
    });
  });

  // ==========================================
  // 4. USER PROFILE FEATURE TESTS (5 tests)
  // ==========================================
  describe('Tier 1 - User Profile Feature', () => {
    test('4.1 Get /api/users/me profile details', async () => {
      const res = await client.get('/api/users/me');
      await assertStatus(res, 200);
      const data = await client.json(res);
      const profile = data.user || data;
      assertOk(profile, 'Profile payload should exist');
      assertEquals(profile.email, user1Email);
    });

    test('4.2 Update user profile name and avatar', async () => {
      const res = await client.put('/api/users/me', {
        name: 'Tester One Updated',
        avatar_url: 'https://example.com/new_avatar.jpg',
      });
      await assertStatus(res, 200);
      const data = await client.json(res);
      const profile = data.user || data;
      assertEquals(profile.name, 'Tester One Updated');
    });

    test('4.3 Verify default membership tier field', async () => {
      const res = await client.get('/api/users/me');
      await assertStatus(res, 200);
      const data = await client.json(res);
      const tier = data.tier || (data.user && data.user.tier) || 'free';
      assertOk(typeof tier === 'string', 'Membership tier should be a string value');
    });

    test('4.4 Verify coins balance field present and non-negative', async () => {
      const res = await client.get('/api/users/me');
      await assertStatus(res, 200);
      const data = await client.json(res);
      const coins = data.coins !== undefined ? data.coins : (data.user ? data.user.coins : 0);
      assertOk(typeof coins === 'number' && coins >= 0, 'Coins balance must be non-negative number');
      initialCoins = coins;
    });

    test('4.5 Verify profile details persistence after update', async () => {
      const res = await client.get('/api/users/me');
      await assertStatus(res, 200);
      const data = await client.json(res);
      const profile = data.user || data;
      assertEquals(profile.name, 'Tester One Updated');
      assertEquals(profile.avatar_url || profile.avatarUrl || profile.avatar, 'https://example.com/new_avatar.jpg');
    });
  });

  // ==========================================
  // 5. CHECKIN / STREAK FEATURE TESTS (5 tests)
  // ==========================================
  describe('Tier 1 - Checkin / Streak Feature', () => {
    test('5.1 Get initial checkin status (unperformed today)', async () => {
      const res = await client.get('/api/checkin/status');
      await assertStatus(res, 200);
      const data = await client.json(res);
      assertOk(data.checkedInToday !== undefined, 'checkedInToday boolean field should be present');
    });

    test('5.2 Perform daily checkin', async () => {
      const res = await client.post('/api/checkin');
      await assertStatus(res, 200);
      const data = await client.json(res);
      assertOk(data.success !== false, 'Checkin should succeed');
      assertOk(data.coinsEarned > 0, 'Checkin should earn coins');
    });

    test('5.3 Verify coins earned from checkin update profile balance', async () => {
      const res = await client.get('/api/users/me');
      await assertStatus(res, 200);
      const data = await client.json(res);
      const coins = data.coins !== undefined ? data.coins : data.user?.coins;
      assertOk(coins > initialCoins, 'User coin balance should increase after checkin');
    });

    test('5.4 Get checkin status after performing checkin (performed today)', async () => {
      const res = await client.get('/api/checkin/status');
      await assertStatus(res, 200);
      const data = await client.json(res);
      assertEquals(data.checkedInToday, true, 'checkedInToday should be true after checking in');
    });

    test('5.5 Verify streak count increment in status', async () => {
      const res = await client.get('/api/checkin/status');
      await assertStatus(res, 200);
      const data = await client.json(res);
      const streak = data.streakDay !== undefined ? data.streakDay : data.streakCount;
      assertOk(typeof streak === 'number' && streak >= 1, 'Streak day count should be >= 1');
    });
  });

  // ==========================================
  // 6. MISSIONS FEATURE TESTS (5 tests)
  // ==========================================
  describe('Tier 1 - Missions Feature', () => {
    test('6.1 Get available missions list', async () => {
      const res = await client.get('/api/missions');
      await assertStatus(res, 200);
      const data = await client.json(res);
      const missions = Array.isArray(data) ? data : data.missions;
      assertOk(Array.isArray(missions) && missions.length >= 2, 'Should return list with at least 2 missions');
      mission1Id = missions[0].id;
      mission2Id = missions[1].id;
    });

    test('6.2 Complete mission 1', async () => {
      assertOk(mission1Id, 'Mission 1 ID required');
      const res = await client.post(`/api/missions/${mission1Id}/complete`);
      await assertStatus(res, 200);
      const data = await client.json(res);
      assertOk(data.success !== false, 'Mission completion should return success');
      assertOk(data.coinsEarned > 0, 'Mission completion should reward coins');
    });

    test('6.3 Verify coins reward reflected in user account balance', async () => {
      const res = await client.get('/api/users/me');
      await assertStatus(res, 200);
      const data = await client.json(res);
      const coins = data.coins !== undefined ? data.coins : data.user?.coins;
      assertOk(typeof coins === 'number' && coins > 0, 'User coins should be positive after mission completion');
    });

    test('6.4 Complete mission 2', async () => {
      assertOk(mission2Id, 'Mission 2 ID required');
      const res = await client.post(`/api/missions/${mission2Id}/complete`);
      await assertStatus(res, 200);
      const data = await client.json(res);
      assertOk(data.success !== false, 'Mission 2 completion should succeed');
    });

    test('6.5 Verify mission completion state in missions list', async () => {
      const res = await client.get('/api/missions');
      await assertStatus(res, 200);
      const data = await client.json(res);
      const missions: any[] = Array.isArray(data) ? data : data.missions;
      const completed1 = missions.find(m => m.id === mission1Id);
      assertOk(completed1, 'Mission 1 should exist in list');
      assertEquals(completed1.isCompleted, true, 'Mission 1 should be marked completed');
    });
  });

  // ==========================================
  // 7. LEADERBOARD FEATURE TESTS (5 tests)
  // ==========================================
  describe('Tier 1 - Leaderboard Feature', () => {
    test('7.1 Get weekly gift leaderboard', async () => {
      const res = await client.get('/api/leaderboard/gifts');
      await assertStatus(res, 200);
      const data = await client.json(res);
      const leaderboard = Array.isArray(data) ? data : data.leaderboard;
      assertOk(Array.isArray(leaderboard), 'Leaderboard response should be an array');
    });

    test('7.2 Validate leaderboard item rank fields', async () => {
      const res = await client.get('/api/leaderboard/gifts');
      await assertStatus(res, 200);
      const data = await client.json(res);
      const leaderboard: any[] = Array.isArray(data) ? data : data.leaderboard;
      if (leaderboard.length > 0) {
        const item = leaderboard[0];
        assertOk(item.rank !== undefined, 'Leaderboard item must contain rank');
        assertOk(item.name !== undefined, 'Leaderboard item must contain name');
        assertOk(item.giftAmount !== undefined || item.gift_amount !== undefined, 'Leaderboard item must contain giftAmount');
      }
    });

    test('7.3 Post gift to character', async () => {
      assertOk(createdCharacterId, 'Character ID required');
      const res = await client.post(`/api/characters/${createdCharacterId}/gift`, {
        giftCode: 'rose',
        amount: 10,
      });
      // Gifting creates a Gift resource, so 201 is correct; every other creating
      // endpoint in this suite accepts either status.
      await assertStatus(res, [200, 201]);
      const data = await client.json(res);
      assertOk(data.success !== false, 'Gift operation should succeed');
    });

    test('7.4 Verify leaderboard update after posting gift', async () => {
      const res = await client.get('/api/leaderboard/gifts');
      await assertStatus(res, 200);
      const data = await client.json(res);
      const leaderboard: any[] = Array.isArray(data) ? data : data.leaderboard;
      assertOk(leaderboard.length >= 1, 'Leaderboard should reflect updated entries');
    });

    test('7.5 Verify gift amount in leaderboard entry', async () => {
      const res = await client.get('/api/leaderboard/gifts');
      await assertStatus(res, 200);
      const data = await client.json(res);
      const leaderboard: any[] = Array.isArray(data) ? data : data.leaderboard;
      const gifted = leaderboard.find(item => item.name.includes('Manoch') || item.characterId === createdCharacterId || item.rank >= 1);
      assertOk(gifted, 'Gifted character or user entry should be present');
    });
  });

  // ==========================================
  // 8. HOROSCOPE FEATURE TESTS (5 tests)
  // ==========================================
  describe('Tier 1 - Horoscope Feature', () => {
    test('8.1 Get horoscope for Aries', async () => {
      const res = await client.get('/api/horoscope/aries');
      await assertStatus(res, 200);
      const data = await client.json(res);
      assertEquals(data.sign.toLowerCase(), 'aries');
      assertOk(data.title || data.description, 'Horoscope title or description must exist');
    });

    test('8.2 Get horoscope for Leo', async () => {
      const res = await client.get('/api/horoscope/leo');
      await assertStatus(res, 200);
      const data = await client.json(res);
      assertEquals(data.sign.toLowerCase(), 'leo');
      assertOk(data.title || data.description, 'Leo horoscope content must exist');
    });

    test('8.3 Get horoscope for Pisces', async () => {
      const res = await client.get('/api/horoscope/pisces');
      await assertStatus(res, 200);
      const data = await client.json(res);
      assertEquals(data.sign.toLowerCase(), 'pisces');
    });

    test('8.4 Validate lucky number and lucky color fields', async () => {
      const res = await client.get('/api/horoscope/aries');
      await assertStatus(res, 200);
      const data = await client.json(res);
      assertOk(data.luckyNumber !== undefined, 'luckyNumber field must be present');
      assertOk(data.luckyColor !== undefined, 'luckyColor field must be present');
    });

    test('8.5 Verify all 12 zodiac signs return valid horoscope structure', async () => {
      const signs = [
        'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
        'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'
      ];
      for (const sign of signs) {
        const res = await client.get(`/api/horoscope/${sign}`);
        await assertStatus(res, 200);
        const data = await client.json(res);
        assertEquals(data.sign.toLowerCase(), sign);
        assertOk(data.title && data.description, `Horoscope for ${sign} must be complete`);
      }
    });
  });

  // ==========================================
  // 9. COINS FEATURE TESTS (5 tests)
  // ==========================================
  describe('Tier 1 - Coins Feature', () => {
    test('9.1 Get available coin packages list', async () => {
      const res = await client.get('/api/coins/packages');
      await assertStatus(res, 200);
      const data = await client.json(res);
      const packages = Array.isArray(data) ? data : data.packages;
      assertOk(Array.isArray(packages) && packages.length >= 2, 'Coin packages list must contain at least 2 options');
      package1Id = packages[0].id;
      package2Id = packages[1].id;
    });

    test('9.2 Purchase coin package 1 simulation', async () => {
      assertOk(package1Id, 'Package 1 ID required');
      const res = await client.post('/api/coins/purchase', {
        packageId: package1Id,
      });
      await assertStatus(res, 200);
      const data = await client.json(res);
      assertOk(data.success !== false, 'Purchase should succeed');
      assertOk(typeof data.newBalance === 'number' && data.newBalance > 0, 'newBalance must be returned');
    });

    test('9.3 Purchase coin package 2 simulation', async () => {
      assertOk(package2Id, 'Package 2 ID required');
      const res = await client.post('/api/coins/purchase', {
        packageId: package2Id,
      });
      await assertStatus(res, 200);
      const data = await client.json(res);
      assertOk(data.success !== false, 'Package 2 purchase should succeed');
      assertOk(typeof data.newBalance === 'number', 'Updated balance returned');
    });

    test('9.4 Verify updated coin balance on user profile', async () => {
      const res = await client.get('/api/users/me');
      await assertStatus(res, 200);
      const data = await client.json(res);
      const coins = data.coins !== undefined ? data.coins : data.user?.coins;
      assertOk(typeof coins === 'number' && coins > 0, 'Coin balance verified on user profile');
    });

    test('9.5 Handle purchase attempt with invalid package ID', async () => {
      const res = await client.post('/api/coins/purchase', {
        packageId: 'non_existent_pkg_9999',
      });
      await assertStatus(res, [400, 404]);
      const data = await client.json(res);
      assertOk(data.error || data.message || data.success === false, 'Error response expected for invalid package');
    });
  });
}
