/**
 * 他眼中的你（Mirror）共用类型。前台、接口与测试都用这一份定义，
 * 字段名与长度上限跟设置中心一一对应，不另起一套前端常量。
 */

/** AI 生成结果：称号、三条观察、一句金句、两个娱乐指数。 */
export type MirrorIndices = {
  /** 氛围感，0–100 的整数。 */
  atmosphere: number;
  /** 默契度，0–100 的整数。 */
  rapport: number;
};

export type MirrorResultFields = {
  title: string;
  observations: [string, string, string];
  quote: string;
  indices: MirrorIndices;
};

/** 可被公开分享的字段。三题原回答不在其中，分享页永远读不到。 */
export type MirrorPublicResult = MirrorResultFields & {
  shareId: string;
  characterId: string;
  characterName: string;
  characterAvatarUrl: string | null;
  createdAt: string;
  expiresAt: string | null;
};

/** 本人或匿名归属凭据持有人才拿得到的完整视图。 */
export type MirrorOwnerResult = MirrorPublicResult & {
  answers: string[];
  canDelete: boolean;
};

export type MirrorCharacterOption = {
  id: string;
  name: string;
  avatarUrl: string | null;
  tagline: string | null;
};

export type MirrorOverLimitPolicy = 'PAUSE' | 'CHARGE';

/** 额度状态：匿名按 Cookie 与 IP 哈希两路计数，counted 为较严者。 */
export type MirrorQuota = {
  anonymous: boolean;
  limit: number;
  used: number;
  remaining: number;
  overLimitPolicy: MirrorOverLimitPolicy;
  /** PAUSE 时生成按钮是否可用；CHARGE 且未配价格时同样是 false。 */
  canGenerate: boolean;
  /** 额度用尽时给用户的说明，直接展示。 */
  blockedReason: string | null;
  /** 额度按这个时区的自然日重置。 */
  timezone: string;
};

export type MirrorRules = {
  questionCount: number;
  answerMaxChars: number;
  titleMaxChars: number;
  observationMaxChars: number;
  quoteMaxChars: number;
  compareLimit: number;
  resultRetentionDays: number;
};

/**
 * 匿名额度双路计数用的 Cookie 只保存随机主体标识与当日用量，不保存 IP；
 * IP 只以加盐哈希的形式进入计入键。
 */
export const MIRROR_SETTINGS = {
  enabled: 'mirror.enabled',
  questionCount: 'mirror.questionCount',
  answerMaxChars: 'mirror.answerMaxChars',
  anonymousDailyLimit: 'mirror.anonymousDailyLimit',
  userDailyLimit: 'mirror.userDailyLimit',
  compareLimit: 'mirror.compareLimit',
  overLimitPolicy: 'mirror.overLimitPolicy',
  resultRetentionDays: 'mirror.resultRetentionDays',
  titleMaxChars: 'mirror.titleMaxChars',
  observationMaxChars: 'mirror.observationMaxChars',
  quoteMaxChars: 'mirror.quoteMaxChars',
  prompt: 'prompt.mirror',
} as const;

/** 匿名额度 Cookie 名。主体标识与当日用量分开两个 Cookie，互不覆盖。 */
export const MIRROR_SUBJECT_COOKIE = 'xb_mirror_subject';
export const MIRROR_QUOTA_COOKIE = 'xb_mirror_quota';
