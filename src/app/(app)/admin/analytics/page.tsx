'use client';

import {useAuth} from '@/lib/auth-context';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {AnalyticsOverview} from '@/components/admin/analytics/overview';

export default function AnalyticsPage(){
  const {token,isLoading}=useAuth();
  const {permissions,loading,error}=useAdminAccess();
  if(isLoading||loading)return <main className="p-4"><p role="status">正在验证分析权限…</p></main>;
  if(!token)return <main className="p-4"><p role="alert">请先登录。</p></main>;
  if(error)return <main className="p-4"><p role="alert">{error}</p></main>;
  if(!permissions.includes('analytics.read'))return <main className="p-4"><p role="alert">当前账号没有运营分析权限。</p></main>;
  return <AnalyticsOverview token={token}/>;
}
