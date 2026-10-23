'use client';

import {useAdminAccess} from '@admin/components/use-admin-access';
import {AdminNotice, AdminPage} from '@admin/components/admin-page';
import {AnalyticsOverview} from '@admin/components/analytics/overview';

export default function AnalyticsPage(){
  const {sessionActive,permissions,loading,error}=useAdminAccess();
  if(loading||loading)return <AdminPage><AdminNotice tone="loading" title="正在验证分析权限…" /></AdminPage>;
  if(!sessionActive)return <AdminPage><AdminNotice tone="warning" title="请先登录。" /></AdminPage>;
  if(error)return <AdminPage><AdminNotice tone="error" title={error} /></AdminPage>;
  if(!permissions.includes('analytics.read'))return <AdminPage><AdminNotice tone="denied" title="当前账号没有运营分析权限。" /></AdminPage>;
  return <AnalyticsOverview sessionActive={sessionActive}/>;
}
