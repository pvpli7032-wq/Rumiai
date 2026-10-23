'use client';
import {useAdminAccess} from '@admin/components/use-admin-access';
import {AdminNotice, AdminPage} from '@admin/components/admin-page';
import {ComplianceSettings} from '@admin/components/compliance/compliance-settings';

export default function CompliancePage() {
  const {sessionActive, permissions, loading, error} = useAdminAccess();
  if (loading || loading) return <AdminPage><AdminNotice tone="loading" title="正在验证合规设置权限…" /></AdminPage>;
  if (!sessionActive) return <AdminPage><AdminNotice tone="warning" title="请先登录。" /></AdminPage>;
  if (error) return <AdminPage><AdminNotice tone="error" title={error} /></AdminPage>;
  if (!permissions.includes('compliance.read')) return <AdminPage><AdminNotice tone="denied" title="当前账号没有合规设置查看权限。" /></AdminPage>;
  return <ComplianceSettings canManage={permissions.includes('compliance.manage')} />;
}
