import {db, pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {readSettingValue} from '@rumiai/backend/modules/settings/index';

/**
 * 新手引导（V3 表 9 增长「引导开关、兴趣标签」、表 22「新手引导：可跳过；
 * 选兴趣、推荐角色、开始第一次互动」）。
 *
 * 引导是可选流程：开关关闭、已完成后端都不拦，前端据 completed 决定要不要跳过去。
 * 兴趣标签只存用户选择，不做个性化推荐算法 —— 推荐角色按标签命中数排序，
 * 一个都没命中就按热度，不引入评分模型。
 */
export interface OnboardingView {
  enabled: boolean;
  completed: boolean;
  interestTags: string[];
  interests: string[];
  openingSuggestions: string[];
  openingMaxChars: number;
  recommended: {id: string; name: string; summary: string | null; avatarUrl: string | null}[];
}

async function readInterestTags(): Promise<string[]> {
  const raw = await readSettingValue<string[]>('growth.interestTags').catch(() => []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim());
}

/** Auth responses use the same gate as the onboarding page, without loading recommendations. */
export async function shouldStartOnboarding(onboardedAt: Date | null): Promise<boolean> {
  if (onboardedAt) return false;
  return await readSettingValue<boolean>('growth.onboardingEnabled').catch(() => false) === true;
}

function parseInterests(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** 推荐角色：优先命中兴趣标签，其次按对话热度；只取已审核公开的角色。 */
async function readRecommended(interests: string[]) {
  const limit = await readSettingValue<number>('growth.recommendationLimit');
  await pragmasReady;
  const popular = await db.character.findMany({
    where: {isPublic: true, reviewStatus: 'APPROVED'},
    orderBy: [{chatCount: 'desc'}, {createdAt: 'desc'}],
    take: 24,
    select: {id: true, name: true, tagline: true, avatarUrl: true, tags: true},
  });
  const matching = interests.length ? await db.character.findMany({
    where: {isPublic: true, reviewStatus: 'APPROVED', OR: interests.map(tag => ({OR: [
      {tags: tag}, {tags: {startsWith: tag + ','}}, {tags: {endsWith: ',' + tag}}, {tags: {contains: ',' + tag + ','}},
    ]}))},
    orderBy: [{chatCount: 'desc'}, {createdAt: 'desc'}, {id: 'asc'}],
    take: 24,
    select: {id: true, name: true, tagline: true, avatarUrl: true, tags: true},
  }) : [];
  const characters = [...new Map([...matching, ...popular].map(character => [character.id, character])).values()];
  const scored = characters.map(character => {
    const tags = (character.tags ?? '').split(',').map(tag => tag.trim()).filter(Boolean);
    const hits = interests.length === 0 ? 0 : tags.filter(tag => interests.includes(tag)).length;
    return {character, hits};
  });
  scored.sort((a, b) => b.hits - a.hits);
  return scored.slice(0, limit).map(({character}) => ({
    id: character.id,
    name: character.name,
    summary: character.tagline ?? null,
    avatarUrl: character.avatarUrl ?? null,
  }));
}

export async function readOnboarding(userId: string, previewInterests?: string[]): Promise<OnboardingView> {
  const [enabled, tags, account, openingSuggestions, openingMaxChars] = await Promise.all([
    readSettingValue<boolean>('growth.onboardingEnabled').catch(() => false),
    readInterestTags(),
    db.user.findUnique({where: {id: userId}, select: {interestsJson: true, onboardedAt: true}}),
    readSettingValue<string[]>('growth.openingSuggestions'),
    readSettingValue<number>('chat.maxMessageChars'),
  ]);
  if (!account) throw new Error('账号不存在。');
  const interests = previewInterests === undefined ? parseInterests(account.interestsJson)
    : [...new Set(previewInterests.filter(tag => tags.includes(tag)))];
  const completed = account.onboardedAt !== null;
  const on = enabled === true;
  return {
    enabled: on,
    completed,
    interestTags: tags,
    interests,
    openingSuggestions: openingSuggestions.filter(text => typeof text === 'string' && text.trim() && text.length <= openingMaxChars),
    openingMaxChars,
    // 已完成就不再查角色：省一次查询，也让「跳过」之后回到引导页看不到过期推荐。
    recommended: on && !completed ? await readRecommended(interests) : [],
  };
}

/**
 * 保存引导结果。跳过的用户也写 onboardedAt —— 否则每次登录都会被再拉回引导页。
 */
export async function saveOnboarding(userId: string, input: {interests?: unknown; skipped?: boolean}) {
  const known = new Set(await readInterestTags());
  const picked = Array.isArray(input.interests)
    ? input.interests.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(item => known.has(item))
    : [];
  await db.user.update({
    where: {id: userId},
    data: {interestsJson: picked.length > 0 ? JSON.stringify(picked) : null, onboardedAt: new Date()},
  });
  return {ok: true, interests: picked};
}
