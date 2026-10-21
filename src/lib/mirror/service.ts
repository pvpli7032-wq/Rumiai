import {db} from '@/lib/db';
import {getAuthUser} from '@/lib/auth';
import {logWarning} from '@/lib/logger';
import {finishAiCall} from '@/lib/ai/ai-usage';
import {aiErrorCode, type PromptCharacter} from '@/lib/conversations/chat-stream';
import type {AiStreamMetrics} from '@/lib/ai/types';
import {buildMirrorPrompt, buildRepairPrompt, generateMirrorResult, MIRROR_TASK_TYPE, normalizeAnswers} from './generation';
import {createMirrorModelCaller, MirrorModelError} from './model-call';
import {consumeMirrorLimit, effectiveMirrorUsed, mirrorDayKey, mirrorQuotaView, readMirrorUsage, releaseMirrorLimit, type MirrorIdentity} from './limits';
import {hashMirrorIp, mirrorAttributionCookieName, mirrorIpSalt, newMirrorSubject, readCookie, readMirrorQuotaCookie, signMirrorAttribution, toOwnerResult, toPublicResult, type MirrorRow} from './share';
import {readConfigFor, type MirrorConfig} from './config';
import {MirrorError} from './errors';
import {beginMirrorPurchase, isPaidPurchase, purchaseBlockedReason, purchasePlanOf, readPurchasedToday, type BillingTurn} from './purchase';
import {MIRROR_QUOTA_COOKIE, MIRROR_SUBJECT_COOKIE, type MirrorCharacterOption, type MirrorOwnerResult, type MirrorQuota} from './types';

/**
 * 他眼中的你：上下文、角色名单、额度与生成编排。
 *
 * 依赖方向（实施契约 §2）：mirror → billing, settings, ai, community/posts。
 * 超额后的「购买次数」不在这里造扣费逻辑：一次超额生成 = 一张 operation=MIRROR 的
 * 费用单，走 billing 的 hold → settle/release 唯一入口（见 purchase.ts）。
 */

/** 首页「运营指定角色」数量：已审核公开且标了「本站原创」优先，不足用最热门公开角色补齐。 */
const MIRROR_CHARACTER_LIMIT = 6;
/** 匿名主体与归属凭据 Cookie 保留一年。 */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

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

/** 反代后面取真实来源：只认第一段，不解析整条链。 */
function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip')?.trim() || null;
}

export async function listMirrorCharacters(): Promise<MirrorCharacterOption[]> {
  const select = {id: true, name: true, avatarUrl: true, tagline: true} as const;
  const featured = await db.character.findMany({
    where: {isPublic: true, reviewStatus: 'APPROVED', isExclusive: true},
    orderBy: [{chatCount: 'desc'}, {createdAt: 'asc'}],
    take: MIRROR_CHARACTER_LIMIT,
    select,
  });
  if (featured.length >= MIRROR_CHARACTER_LIMIT) return featured;
  const fill = await db.character.findMany({
    where: {isPublic: true, reviewStatus: 'APPROVED', id: {notIn: featured.map(item => item.id)}},
    orderBy: [{chatCount: 'desc'}, {createdAt: 'asc'}],
    take: MIRROR_CHARACTER_LIMIT - featured.length,
    select,
  });
  return [...featured, ...fill];
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

function quotaLimit(config: MirrorConfig, userId: string | null) {
  return userId ? config.userDailyLimit : config.anonymousDailyLimit;
}

/** 额度视图：匿名取 Cookie 与 IP 两路中较严的一路，登录只看用户维度。 */
export function quotaOf(context: MirrorContext, config: MirrorConfig, subject: string | null = context.subject): MirrorQuota {
  return mirrorQuotaView({
    identity: identityOf(context, subject, config.timezone),
    limit: quotaLimit(config, context.userId),
    overLimitPolicy: config.overLimitPolicy,
    timezone: config.timezone,
    // 能买的前提：开关打开 + 已定价 + 已登录（匿名没有余额也没有长期身份）。
    purchasable: config.purchaseEnabled && config.purchaseCoins > 0 && !!context.userId,
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

  const limit = quotaLimit(config, context.userId);
  if (limit <= 0) throw new MirrorError('他眼中的你今天暂停生成，明天再来。', 429, 'MIRROR_OVER_LIMIT');

  const subject = context.userId ? null : context.subject ?? newMirrorSubject();
  const identity = identityOf(context, subject, config.timezone);
  const day = mirrorDayKey(new Date(), config.timezone);

  // 免费额度：先占位，失败再还回去。超额后走购买分支，两条路都只成功计一次。
  let purchase: BillingTurn | null = null;
  if (effectiveMirrorUsed(identity, day) >= limit) {
    if (config.overLimitPolicy !== 'CHARGE' || !context.userId) {
      throw new MirrorError(config.overLimitPolicy === 'CHARGE' ? '今天的次数已用完，购买次数尚未开放，请明天再来。' : '今天的次数已用完，明天再来。', 429, 'MIRROR_OVER_LIMIT');
    }
    const usedToday = await readPurchasedToday(context.userId, config.timezone);
    const plan = purchasePlanOf(config, false, usedToday);
    if (!plan.available) throw new MirrorError(purchaseBlockedReason(plan, config.overLimitPolicy), 429, 'MIRROR_OVER_LIMIT');
    const turn = await beginMirrorPurchase({userId: context.userId, requestId: String(input.requestId ?? '')});
    // 免费模式或未定价时 held=false：退回「额度用尽」，不白送一次。
    if (!isPaidPurchase(turn)) throw new MirrorError(purchaseBlockedReason(plan, config.overLimitPolicy), 429, 'MIRROR_OVER_LIMIT');
    purchase = turn;
  } else {
    const decision = consumeMirrorLimit(identity, limit, day);
    if (!decision.allowed) throw new MirrorError(decision.channel === 'ip' ? '这个网络环境的匿名次数已用完，明天再来。' : '今天的次数已用完，明天再来。', 429, 'MIRROR_OVER_LIMIT');
  }

  const metrics: AiStreamMetrics = {attempts: 0};
  let outcome: Awaited<ReturnType<typeof generateMirrorResult>>;
  try {
    const call = await createMirrorModelCaller(character.id, metrics);
    outcome = await generateMirrorResult({
      call,
      prompt: buildMirrorPrompt({template: config.template, character: character as MirrorCharacterOption & PromptCharacter, answers, rules: config}),
      repairPrompt: raw => buildRepairPrompt({raw, answers, rules: config}),
      limits: config,
    });
  } catch (error) {
    // 失败不占额度也不扣币：成功额度和用户费用只算一次。
    releaseMirrorLimit(identity, day);
    await purchase?.release('mirror_generation_failed');
    await recordMirrorCall({...context, subject}, metrics, 'FAILED', aiErrorCode(error));
    throw toMirrorError(error);
  }
  await recordMirrorCall({...context, subject}, metrics, 'SUCCEEDED');
  await purchase?.settle();

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
      rawJson: outcome.raw.slice(0, 20000),
      status: 'READY',
      expiresAt,
    },
  });
  const publicResult = toPublicResult(saved as MirrorRow, character);
  if (!publicResult) throw new MirrorError('结果保存失败，请稍后重试。', 500, 'MIRROR_SAVE_FAILED');

  const cookies: MirrorCookieWrite[] = [];
  if (!context.userId) {
    cookies.push({name: MIRROR_SUBJECT_COOKIE, value: subject!, maxAge: COOKIE_MAX_AGE, httpOnly: true});
    cookies.push({name: mirrorAttributionCookieName(shareId), value: signMirrorAttribution(subject!, shareId), maxAge: COOKIE_MAX_AGE, httpOnly: true});
    cookies.push({name: MIRROR_QUOTA_COOKIE, value: `${day}:${readMirrorUsage(identity, day).cookieUsed}`, maxAge: COOKIE_MAX_AGE, httpOnly: false});
  }
  return {result: toOwnerResult(publicResult, answers, true), subject, cookies, quota: quotaOf(context, config, subject)};
}
