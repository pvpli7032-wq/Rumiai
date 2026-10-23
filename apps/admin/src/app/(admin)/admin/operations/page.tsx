'use client';

import {useAdminAccess} from '@admin/components/use-admin-access';
import {AdminNotice, AdminPage} from '@admin/components/admin-page';
import {OperationsOverview} from '@admin/components/operations/overview';

export default function OperationsPage(){
  const {sessionActive,permissions,loading,error}=useAdminAccess();
  if(loading)return <AdminPage><AdminNotice tone="loading" title="正在验证运维查看权限…" /></AdminPage>;
  if(!sessionActive)return <AdminPage><AdminNotice tone="warning" title="请先登录。" /></AdminPage>;
  if(error)return <AdminPage><AdminNotice tone="error" title={error} /></AdminPage>;
  if(!permissions.includes('operations.read'))return <AdminPage><AdminNotice tone="denied" title="当前账号没有运维状态查看权限。" /></AdminPage>;
  return <OperationsOverview sessionActive={sessionActive}/>;
}
