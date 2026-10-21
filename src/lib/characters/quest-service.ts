import { db, pragmasReady } from '@/lib/db';
import { isUniqueViolation } from '@/lib/user-identity';
import { grantEarnedCoins } from '@/lib/coins/reward-ledger';
import { notifyCoinsReceived } from '@/lib/notifications/write';
import { notifySafely } from '@/lib/notifications/emit';

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2_000;
const MAX_REWARD = 10_000;
const MAX_QUESTS_PER_CHARACTER = 50;
const MAX_REQUIRED_MESSAGES = 10_000;

export class CharacterQuestError extends Error {
  constructor(message: string, readonly status = 400, readonly progress?: number, readonly target?: number) {
    super(message);
    this.name = 'CharacterQuestError';
  }
}

async function requireReadableCharacter(characterId: string, userId?: string) {
  const character = await db.character.findUnique({where: {id: characterId}, select: {id: true, isPublic: true, reviewStatus: true, creatorId: true}});
  if (!character) throw new CharacterQuestError('Character not found', 404);
  if ((!character.isPublic || character.reviewStatus !== 'APPROVED') && character.creatorId !== userId) {
    throw new CharacterQuestError('Private character access forbidden', 403);
  }
}

export async function listCharacterQuests(characterId: string, userId?: string) {
  await requireReadableCharacter(characterId, userId);
  const quests = await db.characterQuest.findMany({
    where: {characterId, isActive: true}, orderBy: {sortOrder: 'asc'},
    select: {id: true, title: true, description: true, rewardCoins: true, requiredMessages: true, sortOrder: true},
  });
  let progress: Array<{questId: string; isCompleted: boolean; completedAt: Date | null}> = [];
  let messageCount = 0;
  if (userId && quests.length) {
    [progress, messageCount] = await Promise.all([
      db.userCharacterQuest.findMany({where: {userId, questId: {in: quests.map(quest => quest.id)}}, select: {questId: true, isCompleted: true, completedAt: true}}),
      db.message.count({where: {role: 'USER', conversation: {userId, characterId}}}),
    ]);
  }
  const byQuest = new Map(progress.map(item => [item.questId, item]));
  return quests.map(quest => ({
    ...quest,
    progress: Math.min(messageCount, quest.requiredMessages),
    isQualified: messageCount >= quest.requiredMessages,
    isCompleted: byQuest.get(quest.id)?.isCompleted ?? false,
    completedAt: byQuest.get(quest.id)?.completedAt ?? null,
  }));
}

export async function createCharacterQuest(ownerId: string, characterId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CharacterQuestError('任务数据格式不正确。', 400);
  const body = input as Record<string, unknown>;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) throw new CharacterQuestError('title is required', 400);
  if (title.length > MAX_TITLE) throw new CharacterQuestError(`title must be ${MAX_TITLE} characters or fewer`, 400);
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, MAX_DESCRIPTION) : null;
  const rawReward = body.rewardCoins ?? body.reward_coins;
  const rewardCoins = typeof rawReward === 'number' && Number.isFinite(rawReward) ? Math.min(MAX_REWARD, Math.max(0, Math.round(rawReward))) : 0;
  const rawRequired = body.requiredMessages ?? body.required_messages ?? 1;
  if (typeof rawRequired !== 'number' || !Number.isSafeInteger(rawRequired) || rawRequired < 1 || rawRequired > MAX_REQUIRED_MESSAGES) {
    throw new CharacterQuestError(`requiredMessages must be an integer between 1 and ${MAX_REQUIRED_MESSAGES}`, 400);
  }

  await pragmasReady;
  return db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE characters SET chat_count = chat_count WHERE id = ${characterId}`;
    const character = await tx.character.findUnique({where: {id: characterId}, select: {id: true, creatorId: true}});
    if (!character) throw new CharacterQuestError('Character not found', 404);
    if (character.creatorId !== ownerId) throw new CharacterQuestError('Forbidden', 403);
    const existing = await tx.characterQuest.count({where: {characterId}});
    if (existing >= MAX_QUESTS_PER_CHARACTER) throw new CharacterQuestError(`A character may have at most ${MAX_QUESTS_PER_CHARACTER} quests`, 409);
    const quest = await tx.characterQuest.create({
      data: {characterId, title, description, rewardCoins, requiredMessages: rawRequired, sortOrder: existing},
      select: {id: true, title: true, description: true, rewardCoins: true, requiredMessages: true, sortOrder: true, isActive: true},
    });
    return {quest};
  });
}

export async function claimCharacterQuest(userId: string, characterId: string, questId: string) {
  await pragmasReady;
  // 事务里读到的任务标题带出来给通知用，避免通知再查一次库。
  let questTitle = '';
  return db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE users SET account_version = account_version WHERE id = ${userId}`;
    const quest = await tx.characterQuest.findUnique({where: {id: questId}, select: {id: true, characterId: true, title: true, rewardCoins: true, requiredMessages: true, isActive: true}});
    if (!quest || quest.characterId !== characterId) throw new CharacterQuestError('Quest not found', 404);
    if (!quest.isActive) throw new CharacterQuestError('Quest is not active', 409);
    questTitle = quest.title;
    const progress = await tx.message.count({where: {role: 'USER', conversation: {userId, characterId}}});
    if (progress < quest.requiredMessages) throw new CharacterQuestError('Quest condition not met', 409, progress, quest.requiredMessages);

    const claimed = await tx.userCharacterQuest.updateMany({where: {userId, questId, isCompleted: false}, data: {isCompleted: true, completedAt: new Date()}});
    if (!claimed.count) {
      try {
        await tx.userCharacterQuest.create({data: {userId, questId, isCompleted: true, completedAt: new Date()}});
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    }
    const newBalance = await grantEarnedCoins(tx, userId, quest.rewardCoins, `角色任务：${quest.title}`, 'CHARACTER_QUEST_REWARD');
    return {coinsEarned: quest.rewardCoins, newBalance};
  }, {maxWait: 10_000, timeout: 15_000}).then(async result => {
    // 任务奖励到账通知：事务提交后才写，事件键用「任务 + 用户」，同一个任务只通知一次（V3 §26）。
    // result 为 null 说明这次是幂等命中（此前已领取），不重复通知。
    if (result && result.coinsEarned > 0) await notifySafely(() => notifyCoinsReceived({
      userId, transactionId: `quest:${questId}:${userId}`, amount: result.coinsEarned,
      reason: `角色任务「${questTitle}」奖励已到账`,
    }), 'character_quest_reward');
    return result;
  });
}
