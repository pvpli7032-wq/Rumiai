'use client';

import {useAdminAccess} from '@/components/admin/use-admin-access';
import {AdminNotice, AdminPage, AdminPageHeader} from '@/components/admin/admin-page';
import {MerchantManagementPanel} from './merchant-management-panel';

/** Standalone payment-merchant route; business controller is shared with FinanceMerchants. */
export function PaymentMerchantManagement() {
  const {sessionActive, permissions, loading} = useAdminAccess();
  if (loading) return <AdminPage><AdminNotice tone="loading" title="正在验证管理权限…" /></AdminPage>;
  if (!sessionActive || !permissions.includes('payments.merchants.read')) return <AdminPage><AdminNotice tone="denied" title="当前账号没有支付商户查看权限。" /></AdminPage>;
  return <AdminPage>
    <AdminPageHeader eyebrow="财务与支付" title="支付商户" description="密钥采用独立加密主密钥保存；每次保存生成不可变配置版本，新订单固定引用对应版本。" />
    <MerchantManagementPanel sessionActive={sessionActive} permissions={permissions} />
  </AdminPage>;
}
