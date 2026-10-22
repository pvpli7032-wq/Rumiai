'use client';

import {useAuth} from '@/lib/auth-context';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {AdminNotice, AdminPage} from '@/components/admin/admin-page';
import {NotificationStatsPanel} from '@/components/admin/notifications/notification-stats-panel';

export default function NotificationsPage(){
  const {token,isLoading}=useAuth();
  const {permissions,loading,error}=useAdminAccess();
  if(isLoading||loading)return <AdminPage><AdminNotice tone="loading" title="正在验证运维查看权限…" /></AdminPage>;
  if(!token)return <AdminPage><AdminNotice tone="warning" title="请先登录。" /></AdminPage>;
  if(error)return <AdminPage><AdminNotice tone="error" title={error} /></AdminPage>;
  if(!permissions.includes('operations.read'))return <AdminPage><AdminNotice tone="denied" title="当前账号没有运维状态查看权限。" /></AdminPage>;
  return <NotificationStatsPanel token={token}/>;
}
