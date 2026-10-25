/**
 * 计费域共享类型（V3 第 20/21 章）。
 *
 * 金额单位一律是「币」（整数），成本币种由 ai_calls 自己记录；
 * 这里只关心用户可见的费用单与免费次数，因此不出现 token、供应商价格等概念。
 */

/** 固定取值，对应 generation_charges.operation（V3 表 18）。 */
export type ChargeOperation = 'CHAT_SEND' | 'CHAT_REGENERATE' | 'STORY_TURN' | 'MIRROR' | 'DISPUTE_VERDICT' | 'MEMORY_SUMMARY';

/** 状态机（V3 表 17）：HELD → SETTLED / RELEASED；结果不明为 UNKNOWN，只等核对。 */
export type ChargeStatus = 'HELD' | 'SETTLED' | 'RELEASED' | 'UNKNOWN';

/** 这次请求靠什么免扣：免费次数、付费余额，或关闭收费时的免费模式。 */
export type AllowanceSource = 'FREE_QUOTA' | 'PAID' | 'FREE_MODE';

/** 用户取消时怎么收费（V3 表 8 billing.cancelPolicy）。「已输出」指首个内容片段已送达用户。 */
export type CancelPolicy = 'CHARGE_WHEN_OUTPUT' | 'RELEASE_ALWAYS';

export const CANCEL_POLICIES: readonly CancelPolicy[] = ['CHARGE_WHEN_OUTPUT', 'RELEASE_ALWAYS'];

/**
 * 费用单上的「为什么没走正常结算」（V3 §157）。只存代码，不存任何用户内容。
 * 每个值都有真实写入方：用户取消来自 cancel.ts 与取消回调，空回复来自 chat-stream 的
 * EMPTY_RESPONSE，持久化失败来自两条链的 PERSISTENCE_ERROR，调用没开始来自 recovery 的
 * CALL_NEVER_STARTED，其余供应商/超时错误一律归为上游失败。
 */
export const CHARGE_CANCEL_REASONS = ['USER_CANCELLED', 'UPSTREAM_FAILED', 'EMPTY_RESPONSE', 'PERSISTENCE_ERROR', 'NEVER_STARTED'] as const;

export type ChargeCancelReason = (typeof CHARGE_CANCEL_REASONS)[number];

const CANCEL_REASON_ALIASES: Record<string, ChargeCancelReason> = {
  USER_CANCELLED: 'USER_CANCELLED',
  CANCELLED: 'USER_CANCELLED',
  CLIENT_DISCONNECTED: 'USER_CANCELLED',
  AI_CALL_CANCELLED: 'USER_CANCELLED',
  STORY_TURN_CANCELLED: 'USER_CANCELLED',
  EMPTY_RESPONSE: 'EMPTY_RESPONSE',
  PERSISTENCE_ERROR: 'PERSISTENCE_ERROR',
  CALL_NEVER_STARTED: 'NEVER_STARTED',
};

/** 把上游错误码/取消来源归到费用单的原因值；认不出的按上游失败记，绝不猜成用户取消。 */
export function cancelReasonOf(reason: string | null | undefined): ChargeCancelReason {
  return CANCEL_REASON_ALIASES[(reason ?? '').trim().toUpperCase()] ?? 'UPSTREAM_FAILED';
}

/** 负流水对应的消费来源键：预扣后未结算时记「聊天预扣」，结算后归为「聊天消费」。 */
export const HOLD_SOURCE_KEY = 'CHAT_HOLD';
export const SETTLE_SOURCE_KEY = 'CHAT_SPEND';
export const RELEASE_SOURCE_KEY = 'CHAT_RELEASE';

/** 预扣时固化的价格快照；改价、关收费、用户特例到期都不影响已开始请求（V3 §21）。 */
export interface ChargePriceSnapshot {
  operation: ChargeOperation;
  /** 参与定价的模型逻辑键；没有可用模型价时为 null。 */
  modelKey: string | null;
  /** 模型每条基础价（model_coin_prices.coins_per_reply），故事价来自 story.coinPrice。 */
  baseCoins: number;
  /** 聊天价格系数（1000=原价），billing.priceMultiplier 的用户特例或公共值。 */
  multiplier: number;
  membershipMultiplierOrderNo?: string | null;
  membershipDailyOrderNo?: string | null;
  /** ceil(baseCoins × multiplier / 1000)。 */
  coins: number;
  priceSource: 'MODEL_PRICE' | 'STORY_PRICE' | 'MIRROR_PRICE' | 'NONE';
  /** 预扣时所在业务日；未建费用单时为 ''。 */
  day: string;
  pricing: 'CHARGED' | 'FREE_MODE' | 'FREE_MULTIPLIER' | 'NO_PRICE';
  charged: boolean;
  allowanceSource: AllowanceSource;
  /** 免费额度预占凭据；付费或免费模式下为 null。 */
  reservationId?: string | null;
  timezone: string;
  capturedAt: string;
  /**
   * 参与这次定价的设置键版本号（V3 表 4「配置版本」）。键名 → operation_settings.version，
   * 用户特例时是 user_setting_overrides.version。老快照没有这个字段，读出来是 undefined。
   */
  settingsVersion?: Record<string, number>;
}

/** hold 的结果：要么建了请求回执，要么是非聊天免费操作直接放行。 */
export interface ChargeHoldResult {
  requestId: string;
  operation: ChargeOperation;
  /** false = 未建立请求回执；免费聊天可held=true但coins=0，不占用免费额度、不扣余额。 */
  held: boolean;
  chargeId: string | null;
  status: ChargeStatus | null;
  coins: number;
  allowanceSource: AllowanceSource;
  price: ChargePriceSnapshot;
  aiCallId: string | null;
  messageId: string | null;
  conversationId: string | null;
  /** 本次余额扣减值（0 表示没扣）。 */
  debited: number;
  /** 同一 requestId 的重放：返回原费用单与结果，不重复扣币。 */
  replayed: boolean;
  userId: string;
  heldAt: string;
  settledAt: string | null;
  releasedAt: string | null;
}

/** settle / release / markUnknown 的统一结果。 */
export interface ChargeOutcome {
  requestId: string;
  operation: ChargeOperation;
  chargeId: string | null;
  status: ChargeStatus | 'FREE';
  coins: number;
  allowanceSource: AllowanceSource;
  /** 本次真正改动余额的数额（正数）；已结算/已释放再调用时为 0。 */
  balanceDelta: number;
  aiCallId: string | null;
  messageId: string | null;
  heldAt: string | null;
  settledAt: string | null;
  releasedAt: string | null;
  /** 已结算/已释放后重复调用：没有二次扣费也没有二次退款。 */
  replayed: boolean;
  userId: string;
}

export interface QuoteInput {
  userId: string;
  operation: ChargeOperation;
  /** 参与定价的模型逻辑键；省略时取当前默认启用模型。 */
  modelKey?: string | null;
  now?: Date;
}

export type QuoteResult = ChargePriceSnapshot & {userId: string; operation: ChargeOperation; now: string};

export interface HoldInput {
  userId: string;
  requestId: string;
  operation: ChargeOperation;
  conversationId?: string | null;
  modelKey?: string | null;
  /**
   * 用户这次实际提交的内容（SEND 是消息正文，REGENERATE 是被重新生成的目标消息 id）。
   * 用来算 requestHash：同号换内容必须报冲突，不能静默回放旧结果（V3 §20）。
   * 省略时不写摘要，也就没有内容冲突判定——故事链自己有一份回合级摘要。
   */
  requestContent?: string | null;
  now?: Date;
}

export interface SettleInput {
  userId: string;
  requestId: string;
  operation: ChargeOperation;
  messageId?: string | null;
  aiCallId?: string | null;
  /** 结算时一并记下的取消原因（已输出后取消按计费这条路径，V3 §157）。 */
  cancelReason?: string | null;
  now?: Date;
}

export interface ReleaseInput extends SettleInput {
  /** 供应商/业务错误码，写进流水描述便于对账；只存代码，不存内容。 */
  reason?: string | null;
}

/** 免费次数视图，/api/me/quota 与后台都读这一份口径。 */
export interface DailyAllowanceView {
  day: string;
  timezone: string;
  freeLimit: number;
  freeUsed: number;
  freeReserved: number;
  /** 还能用几次免费额度（已扣除并发预占）。 */
  freeRemaining: number;
  /** 当日免费取消次数上限（billing.freeCancelPerDay）与已用次数。 */
  freeCancelDaily: number;
  freeCancelUsed: number;
  freeCancelRemaining: number;
  /** 业务日切换的绝对时刻。 */
  resetAt: string;
}

/** 费用单对外的只读视图（后台对账、恢复任务、消息回执共用）。 */
export interface ChargeRecord {
  id: string;
  userId: string;
  requestId: string;
  operation: ChargeOperation;
  status: ChargeStatus;
  coins: number;
  allowanceSource: AllowanceSource | null;
  conversationId: string | null;
  messageId: string | null;
  aiCallId: string | null;
  heldAt: string;
  settledAt: string | null;
  releasedAt: string | null;
  /** 请求内容摘要；老单据为 null（null 时不做内容冲突判定）。 */
  requestHash: string | null;
  /** 没走正常结算的原因；正常完成时为 null。 */
  cancelReason: ChargeCancelReason | null;
  price: ChargePriceSnapshot;
}
