/** 增长接口的响应形状。字段名与后端契约一致，改名前先改后端。 */

export interface RecommendedCharacter {
  id: string;
  name: string;
  summary: string | null;
  avatarUrl: string | null;
}

export interface OnboardingPayload {
  enabled: boolean;
  interestTags: string[];
  recommended: RecommendedCharacter[];
  completed: boolean;
}

export interface InvitePayload {
  enabled: boolean;
  code: string | null;
  link: string | null;
  rewardCoins: number;
}
export interface ReferralPayload {
  code: {id: string; code: string; status: string; expiresAt: string | null; maxUses: number | null; usedCount: number; version: number};
  parent: {boundAt: string; inviter: {id: string; username: string; displayName: string | null}} | null;
  children: {boundAt: string; invitee: {id: string; username: string; displayName: string | null}}[];
}
