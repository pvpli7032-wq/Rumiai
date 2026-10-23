import {apiFetch} from '@web/lib/api-client';
import type {MembershipAccountPublic,MembershipCatalogPublic,MembershipCheckoutResult,MembershipRefundQuote} from '@rumiai/contracts/memberships';

export const membershipApi = {
  catalog: () => apiFetch<MembershipCatalogPublic>('/api/memberships',{cache:'no-store'}),
  account: (token:string) => apiFetch<MembershipAccountPublic>('/api/me/membership',{token,cache:'no-store'}),
  checkout: (token:string,planCode:string,idempotencyKey:string) => apiFetch<MembershipCheckoutResult>('/api/memberships/checkout',{method:'POST',token,body:{planCode,paymentMethod:'alipay',idempotencyKey}}),
  refundQuote: (token:string,orderNo:string) => apiFetch<MembershipRefundQuote>(`/api/me/membership/refund-preview?orderNo=${encodeURIComponent(orderNo)}`,{token,cache:'no-store'}),
  refund: (token:string,orderNo:string) => apiFetch('/api/me/membership/refund',{method:'POST',token,body:{orderNo,reason:'用户在退款窗口内申请会员退款'}}),
};
