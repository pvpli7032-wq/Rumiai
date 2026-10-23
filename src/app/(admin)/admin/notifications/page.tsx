'use client';

import {useAdminAccess} from '@/components/admin/use-admin-access';
import {AdminNotice, AdminPage} from '@/components/admin/admin-page';
import {NotificationStatsPanel} from '@/components/admin/notifications/notification-stats-panel';

export default function NotificationsPage(){
  const {sessionActive,permissions,loading,error}=useAdminAccess();
  if(loading||loading)return <AdminPage><AdminNotice tone="loading" title="正在验证通知记录查看权限…" /></AdminPage>;
  if(!sessionActive)return <AdminPage><AdminNotice tone="warning" title="请先登录。" /></AdminPage>;
  if(error)return <AdminPage><AdminNotice tone="error" title={error} /></AdminPage>;
  if(!permissions.includes('notifications.read'))return <AdminPage><AdminNotice tone="denied" title="当前账号没有通知记录查看权限。" /></AdminPage>;
  return <NotificationStatsPanel sessionActive={sessionActive}/>;
}
