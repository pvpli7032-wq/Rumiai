import type {MembershipCurrent} from '@rumiai/contracts/memberships';

export type AdminAccountMembershipUsage = {
  consumed: number;
  reserved: number;
  released: number;
};

export type AdminAccountMembershipOrder = {
  orderNo: string;
  planCode: string;
  planName: string;
  amountCents: number | null;
  durationDays: number;
  status: string;
  paidAt: string | null;
  createdAt: string;
  grant: {startsAt: string; expiresAt: string; status: string} | null;
  refund: {status: string; amountCents: number; deductedCents: number} | null;
  usage: AdminAccountMembershipUsage | null;
};

export type AdminAccountLedgerItem = {
  id: string;
  type: string;
  amount: number;
  createdAt: string;
};

export type AdminAccountAssets = {
  membership: {
    current: MembershipCurrent;
    orders: AdminAccountMembershipOrder[];
  };
  finance: {
    visible: boolean;
    ledger: AdminAccountLedgerItem[] | null;
  };
};
