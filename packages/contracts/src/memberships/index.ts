export const MEMBERSHIP_PLAN_CODES = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type MembershipPlanCode = typeof MEMBERSHIP_PLAN_CODES[number];

/** Executable entitlement registry. Values are deliberately numeric so the server can enforce them. */
export const MEMBERSHIP_BENEFIT_RULES = {
  DAILY_FREE_REPLIES: {kind: 'integer', min: 0, max: 10000},
  CHAT_PRICE_MULTIPLIER: {kind: 'number', min: 0.01, max: 10},
  CHARACTER_CREATE_LIMIT: {kind: 'integer', min: 0, max: 1000},
} as const;
export type MembershipBenefitKey = keyof typeof MEMBERSHIP_BENEFIT_RULES;
export type MembershipBenefit = {
  [K in MembershipBenefitKey]: {key: K; label: string; value: number}
}[MembershipBenefitKey];

export type MembershipPlanPublic = {
  id: string;
  code: MembershipPlanCode | string;
  name: string;
  durationDays: number;
  priceCents: number | null;
  benefits: MembershipBenefit[];
  isActive: boolean;
  sortOrder: number;
  version: number;
};

export type MembershipPolicyPublic = {
  refundWindowHours: number;
  usageChargePeriodHours: number;
  version: number;
};

export type MembershipCurrent = {
  orderNo: string;
  planCode: string;
  startsAt: string;
  expiresAt: string;
  /** Latest expiry across this user's non-revoked paid grants, including renewals. */
  renewalExpiresAt: string;
  benefits: MembershipBenefit[];
} | null;

export type MembershipRefundQuote = {
  eligible: boolean;
  reason?: string;
  amountCents: number;
  deductedCents: number;
  used: boolean;
  refundDeadline?: string;
};

export type MembershipAdminPlanInput = {
  id?: string;
  code: string;
  name: string;
  durationDays: number;
  priceCents: number | null;
  benefits: MembershipBenefit[];
  isActive: boolean;
  sortOrder?: number;
  version?: number;
  reason: string;
};

export type MembershipAdminPolicyInput = {
  refundWindowHours: number;
  usageChargePeriodHours: number;
  version: number;
  reason: string;
};

export type MembershipOrderPublic = {
  orderNo:string;planCode:string;planName:string;amountCents:number;durationDays:number;
  status:string;paidAt:string|null;createdAt:string;
  grant:{startsAt:string;expiresAt:string;status:string}|null;
  refund:{status:string;amountCents:number;deductedCents:number}|null;
};
export type MembershipAccountPublic = {membership:MembershipCurrent;orders:MembershipOrderPublic[];nextOrderCursor?:string|null};
export type MembershipCatalogPublic = {plans:MembershipPlanPublic[];policy:MembershipPolicyPublic;benefitDefinitions:MembershipBenefitDefinition[]};
export type MembershipCheckoutResult = {orderNo:string;paymentOrderNo?:string;status:string;amountCnyCents:number;redirectUrl?:string};

/** Describes implemented behavior; plan labels and values still come from admin configuration. */
export type MembershipBenefitDefinition = {key: MembershipBenefitKey; label: string; unit: string; description: string; scope: string};
export const MEMBERSHIP_BENEFIT_DEFINITIONS: MembershipBenefitDefinition[] = [
  {key: 'DAILY_FREE_REPLIES', label: '每日额外免费回复', unit: '次/业务日', description: '增加每日免费回复额度，重置时间按站点业务时区；仍受每日总回复上限限制。', scope: '普通聊天发送与重新生成，按服务端免费额度判定'},
  {key: 'CHAT_PRICE_MULTIPLIER', label: '聊天价格优惠', unit: '倍', description: '对收费聊天应用价格倍率；与账号已有优惠比较，保留更优惠的有效价格，不与免费额度重复扣费。', scope: '普通聊天发送与重新生成的有效金币价格'},
  {key: 'CHARACTER_CREATE_LIMIT', label: '角色创建总上限', unit: '角色总数', description: '提高角色创建总上限，按较高上限生效；公共规则不限制时不会因会员降低额度。只在需要会员扩额时记录使用。', scope: '创建本人角色，不是每月额外赠送数量'},
];
export type MembershipUsageItem = {
  id: string; benefitCode: string; label: string; quantity: number;
  state: 'RESERVED' | 'CONSUMED' | 'RELEASED'; createdAt: string; affectsRefund: boolean;
};
export type MembershipUsagePage = {
  orderNo: string; items: MembershipUsageItem[]; nextCursor: string | null;
  summary: {reserved: number; consumed: number; released: number};
};
