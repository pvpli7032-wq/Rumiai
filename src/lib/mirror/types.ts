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

/**
 * 对比里的一个条目（V3 §23）。
 *
 * 每条 shareId 独立成条：成功给公开结果，失败给原因。整组不会因为其中一条
 * 被删、过期或数据损坏而一起失败，前台据此单独重试那一条。
 *
 * 成功分支的类型是 MirrorPublicResult 而不是 MirrorOwnerResult：对比视图只比结果，
 * 三题原回答在这里结构上就不存在，不需要靠「渲染时不读」来保证。
 */
export type MirrorCompareEntry =
  | {shareId: string; status: 'READY'; result: MirrorPublicResult}
  | {shareId: string; status: 'FAILED'; reason: string};

/**
 * 示例结果（V3 §23「上线内容先准备 6 个角色和每个角色的示例结果」）。
 * 运营在设置中心 mirror.exampleResults 里准备，不是真实用户结果，前台一律标「示例」。
 */
export type MirrorExampleResult = {
  characterId: string;
  title: string;
  observations: [string, string, string];
  quote: string;
  /** 氛围感，0–100。 */
  indexA: number;
  /** 默契度，0–100。 */
  indexB: number;
};

/** 前台看到的示例：与真实结果同形，但没有 shareId、没有回答，也永远不会当成真实结果。 */
export type MirrorExampleView = MirrorResultFields & {characterId: string};

/** 推广角色的来源：后台指定，或名单为空时按热度自动选取。 */
export type MirrorFeaturedSource = 'CONFIGURED' | 'AUTO';

export type MirrorCharacterOption = {
  id: string;
  name: string;
  avatarUrl: string | null;
  tagline: string | null;
  /** 这个角色是被指定的还是自动补齐的；前台不展示，后台配置页用它标来源。 */
  source: MirrorFeaturedSource;
};

export type MirrorOverLimitPolicy = 'PAUSE' | 'CHARGE';

/**
 * 购买次数：超额后按设置里的币价再买一次生成。
 * 只对登录用户开放（匿名没有余额也没有稳定身份）。
 */
export type MirrorPurchase = {
  /** 后台「开放购买次数」开关。 */
  enabled: boolean;
  /** 每次超额生成的币价；0 表示未定价。 */
  coins: number;
  /**
   * 可以尝试购买：开关打开 + 已定价 + 已登录。
   * 每日购买上限与余额在真正购买时校验，所以这里只回答「有没有这个选项」。
   */
  available: boolean;
};

/** 单条通道的额度明细。 */
export type MirrorQuotaChannel = {
  used: number;
  limit: number;
  remaining: number;
};

/**
 * 额度状态。登录只看用户维度；匿名同时走 Cookie 与 IP 两条通道，
 * 各自上限独立（V3 表 9：Cookie 1 次/日、同一 IP 10 次/日），实际放行取较严者。
 */
export type MirrorQuota = {
  anonymous: boolean;
  /** 生效通道的上限与已用；匿名时是当前较严的那条通道。 */
  limit: number;
  used: number;
  /** 两条通道里更少的剩余；为 0 表示免费次数已用完。 */
  remaining: number;
  overLimitPolicy: MirrorOverLimitPolicy;
  /** 免费次数用完后能不能继续生成：要么还有免费次数，要么可以购买。 */
  canGenerate: boolean;
  /** 额度用尽且不能购买时给用户的说明，直接展示。 */
  blockedReason: string | null;
  /** 额度按这个时区的自然日重置。 */
  timezone: string;
  purchase: MirrorPurchase;
  /** 匿名双路明细；登录用户两条都是 null。 */
  channels: {cookie: MirrorQuotaChannel | null; ip: MirrorQuotaChannel | null};
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
  anonymousIpDailyLimit: 'mirror.anonymousIpDailyLimit',
  featuredCharacterIds: 'mirror.featuredCharacterIds',
  questions: 'mirror.questions',
  exampleResults: 'mirror.exampleResults',
  userDailyLimit: 'mirror.userDailyLimit',
  compareLimit: 'mirror.compareLimit',
  overLimitPolicy: 'mirror.overLimitPolicy',
  purchaseEnabled: 'mirror.purchaseEnabled',
  purchaseCoins: 'mirror.purchaseCoins',
  purchaseDailyCap: 'mirror.purchaseDailyCap',
  resultRetentionDays: 'mirror.resultRetentionDays',
  titleMaxChars: 'mirror.titleMaxChars',
  observationMaxChars: 'mirror.observationMaxChars',
  quoteMaxChars: 'mirror.quoteMaxChars',
  prompt: 'prompt.mirror',
} as const;

/** 匿名额度 Cookie 名。主体标识与当日用量分开两个 Cookie，互不覆盖。 */
export const MIRROR_SUBJECT_COOKIE = 'xb_mirror_subject';
export const MIRROR_QUOTA_COOKIE = 'xb_mirror_quota';
