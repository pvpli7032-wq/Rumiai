/**
 * 评理广场的领域类型（V3 第 24 章）。
 *
 * 案例本身复用社区帖子承载评论、点赞与举报，这里只描述「案例、投票、结案」三件事：
 * 候选摘录、发布前的规则快照、投票选择和结案结果。
 */

/** 摘录里的一条消息快照。分享字段一律从这里生成，不回读实时对话。 */
export interface DisputeExcerptMessage {
  messageId: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  createdAt: string;
}

/** 发起前从自己的会话里读出的候选片段。 */
export interface DisputeCandidate {
  messageId: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  createdAt: string;
}

export interface DisputeExcerptOptions {
  enabled: boolean;
  /** 只能选不超过这个条数的连续消息。 */
  maxExcerptMessages: number;
  claimMaxChars: number;
  dailyLimit: number;
  minAccountAgeHours: number;
  maxVoteChanges: number;
  closeAfterHours: number;
  closeAtVotes: number;
  verdictMaxChars: number;
  /** 今天还能发起几次；null 表示未登录，不展示。 */
  remaining: number | null;
  /** 注册时长是否已满；null 表示未登录。 */
  eligible: boolean | null;
  topicName: string;
}

/** 发起时写进 rule_snapshot_json 的规则：此后后台改设置不影响已开案例。 */
export interface DisputeRuleSnapshot {
  version: 1;
  capturedAt: string;
  closeAfterHours: number;
  closeAtVotes: number;
  maxVoteChanges: number;
  verdictMaxChars: number;
  maxExcerptMessages: number;
  claimMaxChars: number;
}

export type DisputeChoice = 'AUTHOR' | 'OTHER' | 'SPLIT';
export type DisputeCloseStatus = 'OPEN' | 'CLOSING' | 'CLOSED';
export type DisputeSort = 'hot' | 'latest' | 'joined';

export interface DisputeTally {
  AUTHOR: number;
  OTHER: number;
  SPLIT: number;
  total: number;
}

export interface DisputeVoteState {
  choice: DisputeChoice;
  /** 已经改过几次票。 */
  reviseCount: number;
  /** 规则快照允许的改票次数。 */
  maxVoteChanges: number;
  remainingChanges: number;
}

/** 结案结果。source 让读者一眼分清模型回应与非 AI 兜底说明。 */
export interface DisputeVerdict {
  status: 'READY' | 'FALLBACK';
  text: string;
  /** 结案票数（不渲染时作为对比）。 */
  outcome: {main: DisputeChoice | null; tally: DisputeTally};
  /** 模型回应字数上限，取创建时的规则快照。 */
  maxChars: number;
  closedAt: string;
  /** 最后一次失败原因，后台排障用；不展示给前台。 */
  failureReason?: string | null;
}

export interface DisputeCaseSummary {
  id: string;
  postId: string;
  claim: string;
  createdAt: string;
  deadlineAt: string;
  closeStatus: DisputeCloseStatus;
  voteCount: number;
  closeAtVotes: number;
  closeAfterHours: number;
  tally: DisputeTally;
  main: DisputeChoice | null;
  author: {id: string; name: string; avatarUrl: string | null};
  character: {id: string; name: string} | null;
  commentCount: number;
  excerptCount: number;
  excerpt: DisputeExcerptMessage[];
  myVote: DisputeVoteState | null;
  /** 本人已撤回（仅「我参与的」列表需要）。 */
  withdrawn?: boolean;
}

export interface DisputeCaseDetail extends DisputeCaseSummary {
  /** 是否已撤回。撤回后停止公开访问。 */
  withdrawn: boolean;
  canVote: boolean;
  isAuthor: boolean;
  verdict: DisputeVerdict | null;
  /** 匿名 vs 登录由页面决定；这里只描述已有内容。 */
  canComment: boolean;
}

export interface DisputeListResult {
  items: DisputeCaseSummary[];
  nextCursor: string | null;
}

/** 后台 / 任务入口共用的轻量案例字段。 */
export interface DisputeCaseRecord {
  id: string;
  postId: string;
  authorId: string;
  characterId: string | null;
  claim: string;
  excerpt: DisputeExcerptMessage[];
  rules: DisputeRuleSnapshot;
  deadlineAt: string;
  voteCount: number;
  closeStatus: DisputeCloseStatus;
  verdict: DisputeVerdict | null;
  closedAt: string | null;
  createdAt: string;
}

export const DISPUTE_CHOICES: readonly DisputeChoice[] = ['AUTHOR', 'OTHER', 'SPLIT'];

export function isDisputeChoice(value: unknown): value is DisputeChoice {
  return typeof value === 'string' && (DISPUTE_CHOICES as readonly string[]).includes(value);
}

export function emptyTally(): DisputeTally {
  return {AUTHOR: 0, OTHER: 0, SPLIT: 0, total: 0};
}

/** 票数最多的选项；平票时返回 null，结案文案不硬指派输赢。 */
export function leadingChoice(tally: DisputeTally): DisputeChoice | null {
  const ranked = DISPUTE_CHOICES.map(choice => ({choice, count: tally[choice]})).sort((a, b) => b.count - a.count);
  if (!ranked[0].count) return null;
  if (ranked[0].count === ranked[1].count) return null;
  return ranked[0].choice;
}

export function isDisputeRules(value: unknown): value is DisputeRuleSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rules = value as Record<string, unknown>;
  return rules.version === 1
    && typeof rules.closeAfterHours === 'number'
    && typeof rules.closeAtVotes === 'number'
    && typeof rules.maxVoteChanges === 'number'
    && typeof rules.verdictMaxChars === 'number';
}
