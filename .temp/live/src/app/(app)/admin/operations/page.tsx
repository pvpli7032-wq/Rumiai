'use client';

import {useAuth} from '@/lib/auth-context';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {OperationsOverview} from '@/components/admin/operations/overview';

export default function OperationsPage(){
  const {token,isLoading}=useAuth(),{permissions,loading,error}=useAdminAccess();
  if(isLoading||loading)return <main className="p-4"><p role="status">正在验证运维查看权限…</p></main>;
  if(!token)return <main className="p-4"><p role="alert">请先登录。</p></main>;
  if(error)return <main className="p-4"><p role="alert">{error}</p></main>;
  if(!permissions.includes('operations.read'))return <main className="p-4"><p role="alert">当前账号没有运维状态查看权限。</p></main>;
  return <OperationsOverview token={token}/>;
}
