import {db} from '@/lib/db';
import {holdCharge, InsufficientCoinsError, ChargeRequestConflictError, readCharge, releaseCharge, settleCharge} from './charge-service';
import {settleCancellation} from './cancel';
import type {ChargeHoldResult, ChargeOperation} from './types';

/**
 * 计费接入粘合层：只给两个接入点用——conversations/chat-application-service（SEND/REGENERATE）
 * 与 stories/turn-service（STORY_TURN）。
 *
 * 两条链共用同一套 quote → hold → settle/release（在 charge-service 里），本文件不碰余额、
 * 不写流水，只负责：解析请求号、把 AiCall/消息回执挂到费用单、按权威结果选择结算或释放、
 * 给前台可展示的计费提示。
 */

/** 一次收费请求的身份；conversationId 只在聊天/故事链存在，新玩法（Mirror/评理/记忆）不伪造会话。 */
export interface BillingParty {
  userId: string;
  conversationId: string | null;
  operation: ChargeOperation;
  requestId: string;
}

export interface BillingNotice {
  charged: boolean;
  coins: number;
  allowanceSource: string;
  /** 已从余额扣除时的剩余币数；免费额度不扣币时为 null。 */
  balance: number | null;
}

export interface BillingTurn {
  requestId: string;
  /** 本次费用单；held=false 表示关闭收费/免费/无币价，没有建单。 */
  hold: ChargeHoldResult;
  /** 首个内容片段已送达用户（V3：已输出即收费）。 */
  sawOutput(): void;
  deliveredOutput(): boolean;
  notice(): BillingNotice | null;
  /** 生成失败（非用户原因）：HELD → RELEASED，免费额度还回去，不消耗免费取消次数；幂等。 */
  release(reason: string): Promise<void>;
  /** 用户取消：按 billing.cancelPolicy 与当日免费取消次数决定释放还是按已输出结算（V3 表 16）。 */
  cancel(input?: {messageId?: string | null; aiCallId?: string | null}): Promise<void>;
  /** 消息已保存：HELD → SETTLED，并记下消息与调用 id 供重放与核对。幂等。 */
  settle(input?: {messageId?: string | null; aiCallId?: string | null}): Promise<void>;
}

export interface ChargeErrorLike {status: number; body: Record<string, unknown>; message: string}

/** charge-service 的失败（余额不足、请求号冲突）转成路由/业务层可以直接回给前台的错误。 */
export function toChargeError(error: unknown): ChargeErrorLike | null {
  if (error instanceof InsufficientCoinsError) {
    return {status: 402, message: error.message, body: {code: error.code, error: error.message, coins: error.coins, balance: error.balance, allowance: error.allowance}};
  }
  if (error instanceof ChargeRequestConflictError) {
    return {status: 409, message: error.message, body: {code: 'REQUEST_CONFLICT', error: error.message}};
  }
  return null;
}

/**
 * 请求号必须由客户端给（V3 §20）：一次点击一个编号，断线后只能拿同一个编号回来查。
 * 缺失或格式非法一律返回 null，由调用方按 400 拒绝——服务端不再自造编号，
 * 否则「重发」和「查询」永远对不上同一笔。
 */
export function readRequestId(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : null;
}

interface JsonBody {requestId?: unknown}
const parsedBodies = new WeakMap<Request, Promise<JsonBody | null>>();

/** 读取请求体（只解析一次，调用方复用）；没有 JSON 请求体时返回 null。 */
export function parseJsonBody(request: Request | null | undefined): Promise<JsonBody | null> {
  if (!request) return Promise.resolve(null);
  const cached = parsedBodies.get(request);
  if (cached) return cached;
  const parsed = request.clone().json().then(body => (body && typeof body === 'object' ? body as JsonBody : null)).catch(() => null);
  parsedBodies.set(request, parsed);
  return parsed;
}

/**
 * 开始一次计费：先 hold 再返回句柄。生成结束后调用方必须 settle 或 release（两者都幂等）。
 */
export async function beginBillingTurn(
  party: BillingParty,
  options: {modelKey?: string | null; requestContent?: string | null; now?: Date} = {},
): Promise<BillingTurn> {
  let delivered = false;
  const hold = await holdCharge({
    userId: party.userId, requestId: party.requestId, operation: party.operation, conversationId: party.conversationId,
    modelKey: options.modelKey ?? null, requestContent: options.requestContent ?? null, now: options.now,
  });
  return {
    requestId: party.requestId,
    hold,
    sawOutput() { delivered = true; },
    deliveredOutput() { return delivered; },
    notice() {
      if (!hold.held) return null;
      // 扣币与否看 allowanceSource：免费额度那条 coins=0 但确实占用了今天的免费次数。
      return {charged: hold.allowanceSource === 'PAID', coins: hold.coins, allowanceSource: hold.allowanceSource, balance: null};
    },
    async release(reason) {
      if (!hold.held) return;
      await releaseCharge({userId: party.userId, requestId: party.requestId, operation: party.operation, reason, aiCallId: hold.aiCallId});
    },
    async cancel(input = {}) {
      if (!hold.held) return;
      await settleCancellation({userId: party.userId, requestId: party.requestId, operation: party.operation, outputDelivered: delivered, messageId: input.messageId ?? null, aiCallId: input.aiCallId ?? hold.aiCallId});
    },
    async settle(input = {}) {
      if (!hold.held) return;
      await settleCharge({userId: party.userId, requestId: party.requestId, operation: party.operation, messageId: input.messageId ?? null, aiCallId: input.aiCallId ?? null});
    },
  };
}

export interface TurnCostReceipt {
  requestId: string;
  chargeId: string | null;
  status: string;
  coins: number;
  allowanceSource: string;
}

/** SSE 结束时的费用回执：本次扣了多少、单据落在哪个状态（前台对账与「去充值」用）。 */
export async function readTurnReceipt(party: BillingParty): Promise<TurnCostReceipt | null> {
  const record = await readCharge(party.userId, party.operation, party.requestId);
  if (!record) return null;
  return {requestId: record.requestId, chargeId: record.id, status: record.status, coins: record.coins, allowanceSource: record.allowanceSource ?? 'PAID'};
}

/** 余额：只给回执展示用，不参与扣费判断（扣费在 charge-service 的条件更新里）。 */
export async function readBalance(userId: string): Promise<number> {
  return (await db.user.findUnique({where: {id: userId}, select: {coins: true}}))?.coins ?? 0;
}