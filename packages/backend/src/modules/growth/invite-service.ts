import {db, pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {readSettingValue} from '@rumiai/backend/modules/settings/index';
import {grantEarnedCoins, isDuplicateReward} from '@rumiai/backend/modules/coins/reward-ledger';
import {recordProductEvent} from '@rumiai/backend/modules/analytics/product-events';
import {ensureActiveInviteCode, resolveInvitation} from '@rumiai/backend/modules/referrals/service';

/**
 * 邀请归属与邀请码（V3 表 9 增长「邀请奖励」、表 22「邀请与分享：记录分享来源、
 * 访问、注册及首次聊天」）。
 *
 * 邀请码是账号自带的稳定标识，首次需要时生成一次后长期复用；不用随机串每次现算，
 * 否则同一个用户每刷新一次「我的」页就换一个码，已发出去的链接全部失效。
 */
/** 读当前邀请开关；关闭时前端不展示入口，注册也不记录归属。 */
export async function readInviteSettings() {
  const [enabled, rewardCoins] = await Promise.all([
    readSettingValue<boolean>('growth.inviteEnabled').catch(() => false),
    readSettingValue<number>('growth.inviteRewardCoins').catch(() => 0),
  ]);
  return {enabled: enabled === true, rewardCoins: Number(rewardCoins) || 0};
}

/**
 * 取本人的邀请码，没有就生成并写回。
 *
 * 唯一约束兜底并发：两个请求同时生成时只有一个写入成功，失败的一方重新读回。
 */
export async function ensureInviteCode(userId: string): Promise<string> {
  return (await ensureActiveInviteCode(userId)).code;
}

/**
 * 被邀请人完成首次聊天后，给邀请人发一次奖励（V3 表 22 邀请奖励）。
 *
 * rewardKey 用被邀请人 id：同一个人一辈子只触发一次，重复调用由唯一约束拦下。
 * 奖励是附带动作，失败不抛给聊天主流程。
 *
 * 漏斗最后一环（首次聊天）在发币之前记：奖励开关关掉、奖励币设成 0 只是不发币，
 * 不代表这段邀请关系没有走到首次聊天。先记事实，再谈发币。
 */
export async function grantInviteRewardIfDue(invitedUserId: string): Promise<boolean> {
  const {enabled, rewardCoins} = await readInviteSettings();
  if (!enabled) return false;
  const invited = await db.user.findUnique({where: {id: invitedUserId}, select: {invitedByUserId: true, deletedAt: true}});
  if (!invited?.invitedByUserId || invited.deletedAt) return false;
  await recordFirstChatOnce(invitedUserId, invited.invitedByUserId);
  if (rewardCoins <= 0) return false;
  const rewardKey = `invite-first-chat:${invitedUserId}`;
  try {
    await db.$transaction(async tx => {
      await grantEarnedCoins(tx, invited.invitedByUserId!, rewardCoins, '邀请好友完成首次聊天', 'INVITE_REWARD', rewardKey);
    });
    return true;
  } catch (error) {
    if (isDuplicateReward(error)) return false;
    throw error;
  }
}

/**
 * 把注册账号归属到邀请码对应的邀请人。
 *
 * 返回邀请人 id 或 null。调用方决定是否允许无效码；注册服务把显式邀请码视为
 * 用户要求的归属并返回可见错误，访问埋点则可安全忽略不存在或已注销的邀请码。
 */
export async function resolveInviterId(inviteCode: string | null | undefined, newUserId: string): Promise<string | null> {
  if (!inviteCode) return null;
  try { const invite = await resolveInvitation(inviteCode); return invite.ownerId === newUserId ? null : invite.ownerId; }
  catch { return null; }
}
/**
 * 邀请漏斗的两端：访问与首次聊天（V3 表 22「记录分享来源、访问、注册及首次聊天」）。
 *
 * 三处口径：
 * - 只由服务端写。访问这一环由邀请链接的落地路由写，不是浏览器自己上报：
 *   预取、刷新、爬虫都会触发页面加载，只有服务端看到的那次请求才算一次访问。
 * - 每个访客对同一个邀请人只记一条。读侧本来就按 DISTINCT 计人，重复写不改变人数，
 *   只会把表撑大；首次聊天同理，一个人一辈子一条。
 * - 邀请码无效、邀请人已注销、没有可归属的访客身份，一律不写也不报错：
 *   埋点出问题不能让落地页打不开。
 */

/** 首次聊天：漏斗最后一环，与奖励开关无关。 */
async function recordFirstChatOnce(invitedUserId: string, inviterId: string): Promise<void> {
  const seen = await db.productEvent.findFirst({where: {name: 'invite_first_chat', userId: invitedUserId}, select: {id: true}});
  if (seen) return;
  await recordProductEvent({event: 'invite_first_chat', userId: invitedUserId, subjectKey: inviterId});
}

/** 访问：邀请链接被打开时记一条。返回是否真的写入了新记录。 */
export async function recordInviteVisit(input: {inviteCode: string | null | undefined; userId: string | null; anonymousSubject: string | null}): Promise<boolean> {
  const code = typeof input.inviteCode === 'string' ? input.inviteCode.trim().toUpperCase() : '';
  if (!code) return false;
  if (!input.userId && !input.anonymousSubject) return false;
  await pragmasReady;
  let inviter: {id: string};
  try { inviter = {id: (await resolveInvitation(code)).ownerId}; } catch { return false; }
  const seen = await db.productEvent.findFirst({
    where: {name: 'invite_visited', subjectKey: inviter.id, ...(input.userId ? {userId: input.userId} : {anonymousSubject: input.anonymousSubject})},
    select: {id: true},
  });
  if (seen) return false;
  await recordProductEvent({
    event: 'invite_visited',
    userId: input.userId,
    anonymousSubject: input.userId ? null : input.anonymousSubject,
    subjectKey: inviter.id,
  });
  return true;
}
