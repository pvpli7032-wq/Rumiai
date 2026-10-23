import {MerchantManagementPanel} from '@admin/components/payments/merchant-management-panel';

/**
 * 「商户」标签（V3 表 14：商户是财务支付的标签之一）。
 *
 * 与 /admin/payments/merchants 同源同接口，复用同一套卡片与表单；
 * 差别只在版式 —— 这里嵌在财务支付的标签里，不重复输出页面标题与 <main>。
 */
export function FinanceMerchants({sessionActive, permissions}: {sessionActive: boolean; permissions: string[]}) {
  return <MerchantManagementPanel sessionActive={sessionActive} permissions={permissions} embedded />;
}
