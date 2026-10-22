import {db} from '@/lib/db';
import {getAuthUser} from '@/lib/auth';
import {logWarning} from '@/lib/logger';
import {finishAiCall} from '@/lib/ai/ai-usage';
import {aiErrorCode, type PromptCharacter} from '@/lib/conversations/chat-stream';
import type {AiStreamMetrics} from '@/lib/ai/types';
import {buildMirrorPrompt, buildRepairPrompt, generateMirrorResult, MIRROR_TASK_TYPE, normalizeAnswers} from './generation';
import {createMirrorModelCaller, MirrorModelError} from './model-call';
import {consumeMirrorLimit, mirrorDayKey, mirrorQuotaView, readMirrorLimitState, readMirrorUsage, releaseMirrorLimit, type MirrorIdentity, type MirrorLimitPlan} from './limits';
import {encodeMirrorSnapshot, hashMirrorIp, mirrorAttributionCookieName, mirrorIpSalt, newMirrorSubject, readCookie, readMirrorQuotaCookie, signMirrorAttribution, toOwnerResult, toPublicResult, type MirrorRow} from './share';
import {readConfigFor, type MirrorConfig} from './config';
import {clientIp} from '@/lib/http/client-ip';
import {MirrorError} from './errors';
import type {BillingTurn} from '@/lib/billing/turn';
import {readMirrorAccess} from '@/lib/ai/task-budget';
import {recordProductEvent} from '@/lib/analytics/product-events';
import {beginMirrorPurchase, isPaidPurchase, purchaseBlockedReason, purchasePlanOf, readPurchasedToday} from './purchase';
import {MIRROR_QUOTA_COOKIE, MIRROR_SUBJECT_COOKIE, type MirrorCharacterOption, type MirrorOwnerResult, type MirrorQuota} from './types';

/**
 * 他眼中的你：上下文、角色名单、额度与生成编排。
 *
 * 依赖方向（实施契约 §2）：mirror → billing, settings, ai, community/posts。
 * 超额后的「购买次数」不在这里造扣费逻辑：一次超额生成 = 一张 operation=MIRROR 的
 * 费用单，走 billing 的 hold → settle/release 唯一入口（见 purchase.ts）。
 */

/**
 * 自动选取时的角色数量（V3 表 22「先 6 个，再补到 20」）。
 *
 * 只约束「名单为空、由系统按热度挑」这一条路：要展示多少个角色由运营在
 * mirror.featuredCharacterIds 里写多少个决定，名单本身就是数量配置，
 * 不再有第二个写死的上限挡住「补到 20」。
 */
const AUTO_CHARACTER_LIMIT = 6;
/** 匿名主体与归属凭据 Cookie 保留一年。 */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const CHARACTER_SELECT = {id: true, name: true, avatarUrl: true, tagline: true} as const;

export type MirrorContext = {
  userId: string | null;
  subject: string | null;
  ipHash: string | null;
  /** 浏览器回传的当日用量，业务日按设置时区判断后才算数。 */
  cookieQuota: {day: string | null; count: number};
};
/** 路由与页面共用的请求身份；别名只是让调用方不必区分两处命名。 */
export type MirrorRequestStateLike = MirrorContext;

/** 登录态走 Authorization 头，匿名主体走服务端签发的 Cookie；IP 只以加盐哈希进入计数。 */
export async function readMirrorContext(request: Request): Promise<MirrorContext> {
  const auth = await getAuthUser(request);
  const cookieHeader = request.headers.get('cookie');
  return {
    userId: auth?.userId ?? null,
    subject: readCookie(cookieHeader, MIRROR_SUBJECT_COOKIE),
    ipHash: hashMirrorIp(clientIp(request), mirrorIpSalt()),
    cookieQuota: readMirrorQuotaCookie(cookieHeader),
  };
}

/** 自动选取：已审核公开且标了「本站原创」优先，不足用最热门公开角色补齐。 */
async function autoFeaturedCharacters(): Promise<MirrorCharacterOption[]> {
  const featured = await db.character.findMany({
    where: {isPublic: true, reviewStatus: 'APPROVED', isExclusive: true},
    orderBy: [{chatCount: 'desc'}, {createdAt: 'asc'}],
    take: AUTO_CHARACTER_LIMIT,
    select: CHARACTER_SELECT,
  });
  const picked = featured.map(item => ({...item, source: 'AUTO' as const}));
  if (picked.length >= AUTO_CHARACTER_LIMIT) return picked;
  const fill = await db.character.findMany({
    where: {isPublic: true, reviewStatus: 'APPROVED', id: {notIn: picked.map(item => item.id)}},
    orderBy: [{chatCount: 'desc'}, {createdAt: 'asc'}],
    take: AUTO_CHARACTER_LIMIT - picked.length,
    select: CHARACTER_SELECT,
  });
  return [...picked, ...fill.map(item => ({...item, source: 'AUTO' as const}))];
}

/**
 * 首页角色名单（V3 表 19）：后台 mirror.featuredCharacterIds 指定优先，按数组顺序取
 * 已审核公开的角色；名单里失效或已下架的 id 直接跳过，不报错。
 * 名单为空、或一个都取不到时回退自动选取——那段代码是 fallback，不是死代码。
 *
 * 名单长度就是展示数量：运营写 20 个 id 就展示 20 个，这里不再截断。
 */
export async function listMirrorCharacters(): Promise<MirrorCharacterOption[]> {
  const config = await readConfigFor(null);
  const ids = config.featuredCharacterIds;
  if (ids.length) {
    const rows = await db.character.findMany({where: {id: {in: ids}, isPublic: true, reviewStatus: 'APPROVED'}, select: CHARACTER_SELECT});
    const byId = new Map(rows.map(row => [row.id, row]));
    const picked = ids.flatMap(id => {
      const row = byId.get(id);
      return row ? [{...row, source: 'CONFIGURED' as const}] : [];
    });
    if (picked.length) return picked;
  }
  return autoFeaturedCharacters();
}

/** 计数用的身份：登录看用户，匿名看 Cookie 主体 + 回传用量 + IP 哈希。 */
export function identityOf(context: MirrorContext, subject: string | null, timezone: string, now = new Date()): MirrorIdentity {
  const reported = context.cookieQuota.day === mirrorDayKey(now, timezone) ? context.cookieQuota.count : 0;
  return {
    userId: context.userId,
    cookieSubject: context.userId ? null : subject,
    cookieReportedCount: context.userId ? 0 : reported,
    ipHash: context.userId ? null : context.ipHash,
  };
}

/** 三条通道的上限：登录只看 userLimit，匿名看 Cookie 与 IP 各自的上限。 */
export function limitPlanOf(config: MirrorConfig): MirrorLimitPlan {
  return {userLimit: config.userDailyLimit, cookieLimit: config.anonymousDailyLimit, ipLimit: config.anonymousIpDailyLimit};
}

/** 额度视图：匿名取 Cookie 与 IP 两路中较严的一路，登录只看用户维度。 */
export function quotaOf(context: MirrorContext, config: MirrorConfig, subject: string | null = context.subject): MirrorQuota {
  return mirrorQuotaView({
    identity: identityOf(context, subject, config.timezone),
    plan: limitPlanOf(config),
    overLimitPolicy: config.overLimitPolicy,
    timezone: config.timezone,
    // 能买的前提：开关打开 + 已定价 + 已登录（匿名没有余额也没有长期身份）。
    purchasable: purchasePlanOf(config, !context.userId).available,
    purchase: purchasePlanOf(config, !context.userId),
  });
}

/** 需要写回浏览器的 Cookie；名字与值都由服务端决定，客户端无法伪造归属。 */
export type MirrorCookieWrite = {name: string; value: string; maxAge: number; httpOnly: boolean};

export type MirrorGenerationResult = {
  result: MirrorOwnerResult;
  /** 本次生成实际使用的匿名主体（新签发或沿用）。 */
  subject: string | null;
  cookies: MirrorCookieWrite[];
  quota: MirrorQuota;
};

/** 统一映射：MirrorGenerationError 已继承 MirrorError，这里只额外收编模型层错误。 */
function toMirrorError(error: unknown): MirrorError {
  if (error instanceof MirrorError) return error;
  if (error instanceof MirrorModelError) return new MirrorError(error.message, 503, error.code);
  return new MirrorError('生成失败，请稍后重试。', 500, 'MIRROR_GENERATION_FAILED');
}

/** 成本计量：所有真实供应商调用都记 AiCall，task_type=mirror；匿名调用没有 userId。 */
export async function recordMirrorCall(context: {userId: string | null; subject: string | null}, metrics: AiStreamMetrics, status: 'SUCCEEDED' | 'FAILED', errorCode?: string) {
  const started = new Date();
  try {
    const call = await db.aiCall.create({
      data: {
        userId: context.userId,
        conversationId: null,
        taskType: MIRROR_TASK_TYPE,
        anonymousSubject: context.userId ? null : context.subject,
        operation: 'MIRROR',
        status: 'STARTED',
        currency: process.env.AI_PRICE_CURRENCY?.trim() || 'USD',
        startedAt: started,
      },
      select: {id: true},
    });
    await finishAiCall(call.id, started, status, metrics, errorCode);
  } catch (error) {
    // 成本记录失败不能把已经生成的结果吞掉，但必须留下痕迹。
    logWarning('mirror_ai_call_record_failed', {status, code: errorCode ?? aiErrorCode(error)});
  }
}

export function newMirrorShareId(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

/** 超额分支：能买就开一张费用单，不能买就按设置给出明确文案。 */
async function openPurchase(config: MirrorConfig, context: MirrorContext, requestId: unknown): Promise<BillingTurn> {
  const plan = purchasePlanOf(config, false);
  const capReached = config.purchaseDailyCap > 0
    && context.userId !== null
    && (await readPurchasedToday(context.userId, config.timezone)) >= config.purchaseDailyCap;
  if (!plan.available || capReached || !context.userId) {
    throw new MirrorError(purchaseBlockedReason(plan, config.overLimitPolicy, capReached), 429, 'MIRROR_OVER_LIMIT');
  }
  const turn = await beginMirrorPurchase({userId: context.userId, requestId: String(requestId ?? '')});
  // 免费模式或未定价时 held=false：退回「额度用尽」，不白送一次。
  if (!isPaidPurchase(turn)) throw new MirrorError(purchaseBlockedReason(plan, config.overLimitPolicy), 429, 'MIRROR_OVER_LIMIT');
  return turn;
}

/** 生成：规则校验 → 双路额度 → 一次生成（含至多一次格式修复） → 保存 → 返回本人视图。 */
export async function generateMirror(context: MirrorContext, input: {answers?: unknown; characterId?: unknown; requestId?: unknown}): Promise<MirrorGenerationResult> {
  const config = await readConfigFor(context.userId);
  if (!config.enabled) throw new MirrorError('他眼中的你暂时关闭。', 404, 'MIRROR_DISABLED');

  const characterId = typeof input.characterId === 'string' ? input.characterId.trim() : '';
  const character = characterId
    ? await db.character.findFirst({
        where: {id: characterId, isPublic: true, reviewStatus: 'APPROVED'},
        select: {id: true, name: true, avatarUrl: true, tagline: true, personality: true, background: true, scenario: true},
      })
    : null;
  if (!character) throw new MirrorError('请选择一个可用的角色。', 400, 'MIRROR_CHARACTER_INVALID');
  const answers = normalizeAnswers(input.answers, config);
  // AI 成本预算闸门：只停本玩法，登录用户不受匿名预算影响。放在输入校验之后，
  // 这样参数错误仍然是 400，不会因为预算关闭被误报成额度问题。
  const access = await readMirrorAccess(!context.userId);
  if (!access.open) throw new MirrorError(access.message, 429, 'MIRROR_BUDGET_PAUSED');

  const plan = limitPlanOf(config);
  const subject = context.userId ? null : context.subject ?? newMirrorSubject();
  const identity = identityOf(context, subject, config.timezone);
  const day = mirrorDayKey(new Date(), config.timezone);

  // 免费额度：先占位，失败再还回去。超额后走购买分支，两条路都只成功计一次。
  let chargeTurn: BillingTurn | null = null;
  const state = readMirrorLimitState(identity, plan, day);
  if (state.remaining <= 0) {
    // 上限为 0（运营暂停）不该提示「去买次数」；文案统一由额度视图给出。
    const purchase = purchasePlanOf(config, !context.userId);
    if (config.overLimitPolicy === 'CHARGE' && purchase.available) {
      chargeTurn = await openPurchase(config, context, input.requestId);
    } else {
      throw new MirrorError(quotaOf(context, config, subject).blockedReason ?? '今天的次数已用完，明天再来。', 429, 'MIRROR_OVER_LIMIT');
    }
  } else {
    const decision = consumeMirrorLimit(identity, plan, day);
    if (!decision.allowed) {
      throw new MirrorError(decision.channel === 'ip' ? '这个网络环境的匿名次数已用完，明天再来。' : '今天的次数已用完，明天再来。', 429, 'MIRROR_OVER_LIMIT');
    }
  }

  const metrics: AiStreamMetrics = {attempts: 0};
  let outcome: Awaited<ReturnType<typeof generateMirrorResult>>;
  try {
    const call = await createMirrorModelCaller(character.id, metrics);
    outcome = await generateMirrorResult({
      call,
      prompt: buildMirrorPrompt({template: config.template, character: character as MirrorCharacterOption & PromptCharacter, answers, rules: config, observationStyle: config.observationStyle}),
      repairPrompt: raw => buildRepairPrompt({raw, answers, rules: config}),
      limits: config,
    });
  } catch (error) {
    // 失败不占额度也不扣币：成功额度和用户费用只算一次。
    releaseMirrorLimit(identity, day);
    await chargeTurn?.release('mirror_generation_failed');
    await recordMirrorCall({...context, subject}, metrics, 'FAILED', aiErrorCode(error));
    throw toMirrorError(error);
  }
  await recordMirrorCall({...context, subject}, metrics, 'SUCCEEDED');
  await chargeTurn?.settle();

  const shareId = newMirrorShareId();
  const expiresAt = context.userId ? null : new Date(Date.now() + config.resultRetentionDays * 24 * 60 * 60 * 1000);
  const saved = await db.mirrorResult.create({
    data: {
      shareId,
      userId: context.userId,
      anonymousSubject: subject,
      characterId: character.id,
      answersJson: JSON.stringify(answers),
      title: outcome.fields.title,
      observationsJson: JSON.stringify(outcome.fields.observations),
      quote: outcome.fields.quote,
      indicesJson: JSON.stringify(outcome.fields.indices),
      // 模型原文与生成时的版式一起存档；版式只影响新结果（V3 表 9），所以按结果冻结。
      rawJson: encodeMirrorSnapshot(outcome.raw.slice(0, 20000), config.resultLayout),
      status: 'READY',
      // 费用关联：hold 一建单就有 chargeId，settle 不会换 id，所以在结果行上直接落这一笔。
      // 免费/未开收费时 hold.held=false、chargeId=null，结果照常保存，不伪造关联。
      chargeId: chargeTurn?.hold.chargeId ?? null,
      expiresAt,
    },
  });
  const publicResult = toPublicResult(saved as MirrorRow, character);
  if (!publicResult) throw new MirrorError('结果保存失败，请稍后重试。', 500, 'MIRROR_SAVE_FAILED');

  // 漏斗「生成完成」由服务端在结果落库后写，不接受客户端自称完成（V3 表 22）。
  // 匿名主体与配额计数、结果行用同一个 subject，不另算一个标识。
  void recordProductEvent({event: 'mirror_completed', userId: context.userId ?? null, anonymousSubject: context.userId ? null : subject, subjectKey: shareId});

  const cookies: MirrorCookieWrite[] = [];
  if (!context.userId) {
    cookies.push({name: MIRROR_SUBJECT_COOKIE, value: subject!, maxAge: COOKIE_MAX_AGE, httpOnly: true});
    cookies.push({name: mirrorAttributionCookieName(shareId), value: signMirrorAttribution(subject!, shareId), maxAge: COOKIE_MAX_AGE, httpOnly: true});
    cookies.push({name: MIRROR_QUOTA_COOKIE, value: `${day}:${readMirrorUsage(identity, day).cookieUsed}`, maxAge: COOKIE_MAX_AGE, httpOnly: false});
  }
  return {result: toOwnerResult(publicResult, answers, true), subject, cookies, quota: quotaOf(context, config, subject)};
}
