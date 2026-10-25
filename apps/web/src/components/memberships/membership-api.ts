import {apiFetch, apiRaw} from '@web/lib/api-client';
import type {MembershipAccountPublic,MembershipCatalogPublic,MembershipCheckoutResult,MembershipRefundQuote,MembershipUsagePage} from '@rumiai/contracts/memberships';

export const membershipApi = {
  catalog: () => apiFetch<MembershipCatalogPublic>('/api/memberships',{cache:'no-store'}),
  // Coins and memberships are separate order domains, but both are governed by this public checkout policy.
  checkoutAvailability: async () => { const response = await apiRaw('/api/coins/packages', {cache: 'no-store'}); await response.arrayBuffer(); return {enabled: response.headers.get('X-Checkout-Enabled') === 'true', reason: response.headers.get('X-Checkout-Reason') ?? ''}; },
  account: (token:string) => apiFetch<MembershipAccountPublic>('/api/me/membership',{token,cache:'no-store'}),
  checkout: (token:string,planCode:string,idempotencyKey:string) => apiFetch<MembershipCheckoutResult>('/api/memberships/checkout',{method:'POST',token,body:{planCode,paymentMethod:'alipay',idempotencyKey}}),
  usage: (token:string,orderNo:string,cursor?:string|null) => apiFetch<MembershipUsagePage>('/api/me/membership/usage?' + new URLSearchParams({orderNo,...(cursor?{cursor}:{})}), {token,cache:'no-store'}),
  refundQuote: (token:string,orderNo:string) => apiFetch<MembershipRefundQuote>(`/api/me/membership/refund-preview?orderNo=${encodeURIComponent(orderNo)}`,{token,cache:'no-store'}),
  refund: (token:string,orderNo:string) => apiFetch('/api/me/membership/refund',{method:'POST',token,body:{orderNo,reason:'用户在退款窗口内申请会员退款'}}),
};
