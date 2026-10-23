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
export type MembershipAccountPublic = {membership:MembershipCurrent;orders:MembershipOrderPublic[]};
export type MembershipCatalogPublic = {plans:MembershipPlanPublic[];policy:MembershipPolicyPublic};
export type MembershipCheckoutResult = {orderNo:string;paymentOrderNo?:string;status:string;amountCnyCents:number;redirectUrl?:string};
