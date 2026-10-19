'use client';
import {useAuth} from '@/lib/auth-context';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {AdminNotice, AdminPage} from '@/components/admin/admin-page';
import {ComplianceSettings} from '@/components/admin/compliance/compliance-settings';

export default function CompliancePage() {
  const {token, isLoading} = useAuth();
  const {permissions, loading, error} = useAdminAccess();
  if (isLoading || loading) return <AdminPage><AdminNotice tone="loading" title="正在验证合规设置权限…" /></AdminPage>;
  if (!token) return <AdminPage><AdminNotice tone="warning" title="请先登录。" /></AdminPage>;
  if (error) return <AdminPage><AdminNotice tone="error" title={error} /></AdminPage>;
  if (!permissions.includes('compliance.read')) return <AdminPage><AdminNotice tone="denied" title="当前账号没有合规设置查看权限。" /></AdminPage>;
  return <ComplianceSettings canManage={permissions.includes('compliance.manage')} />;
}
