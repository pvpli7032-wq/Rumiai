import {randomBytes} from 'node:crypto';
import {db, pragmasReady} from '@/lib/db';
import {readSettingValue} from '@/lib/settings';
import {grantEarnedCoins, isDuplicateReward} from '@/lib/coins/reward-ledger';

/**
 * 邀请归属与邀请码（V3 表 9 增长「邀请奖励」、表 22「邀请与分享：记录分享来源、
 * 访问、注册及首次聊天」）。
 *
 * 邀请码是账号自带的稳定标识，首次需要时生成一次后长期复用；不用随机串每次现算，
 * 否则同一个用户每刷新一次「我的」页就换一个码，已发出去的链接全部失效。
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

function randomCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

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
  await pragmasReady;
  const current = await db.user.findUnique({where: {id: userId}, select: {inviteCode: true}});
  if (!current) throw new Error('账号不存在。');
  if (current.inviteCode) return current.inviteCode;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    try {
      // 条件写入：只有当前还没有码时才写。并发时后到的那次改不动任何行，
      // 于是回读先写成功的那个码 —— 否则每个并发请求都返回自己生成的码，
      // 已发出去的链接就会指向不存在的邀请码。
      const written = await db.user.updateMany({where: {id: userId, inviteCode: null}, data: {inviteCode: code}});
      if (written.count === 1) return code;
      const existing = await db.user.findUnique({where: {id: userId}, select: {inviteCode: true}});
      if (existing?.inviteCode) return existing.inviteCode;
      continue;
    } catch (error) {
      // 唯一冲突：撞了别人的码，换一个再试。
      if (typeof error === 'object' && error !== null && (error as {code?: string}).code === 'P2002') continue;
      throw error;
    }
  }
  throw new Error('邀请码生成失败，请重试。');
}

/**
 * 被邀请人完成首次聊天后，给邀请人发一次奖励（V3 表 22 邀请奖励）。
 *
 * rewardKey 用被邀请人 id：同一个人一辈子只触发一次，重复调用由唯一约束拦下。
 * 奖励是附带动作，失败不抛给聊天主流程。
 */
export async function grantInviteRewardIfDue(invitedUserId: string): Promise<boolean> {
  const {enabled, rewardCoins} = await readInviteSettings();
  if (!enabled || rewardCoins <= 0) return false;
  const invited = await db.user.findUnique({where: {id: invitedUserId}, select: {invitedByUserId: true, deletedAt: true}});
  if (!invited?.invitedByUserId || invited.deletedAt) return false;
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
 * 返回邀请人 id 或 null。自己邀请自己、邀请码不存在、邀请人已注销都不记录归属，
 * 也不报错 —— 注册不能因为邀请码写错而失败。
 */
export async function resolveInviterId(inviteCode: string | null | undefined, newUserId: string): Promise<string | null> {
  const code = typeof inviteCode === 'string' ? inviteCode.trim().toUpperCase() : '';
  if (!code) return null;
  const inviter = await db.user.findUnique({where: {inviteCode: code}, select: {id: true, deletedAt: true}});
  if (!inviter || inviter.deletedAt || inviter.id === newUserId) return null;
  return inviter.id;
}
