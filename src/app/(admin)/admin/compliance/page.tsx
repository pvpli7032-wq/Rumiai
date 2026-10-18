'use client';
import {useAuth} from '@/lib/auth-context';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {ComplianceSettings} from '@/components/admin/compliance/compliance-settings';
export default function CompliancePage(){const {token,isLoading}=useAuth();const {permissions,loading,error}=useAdminAccess();if(isLoading||loading)return <main className="p-4">正在验证合规设置权限…</main>;if(!token)return <main className="p-4" role="alert">请先登录。</main>;if(error)return <main className="p-4" role="alert">{error}</main>;if(!permissions.includes('compliance.read'))return <main className="p-4" role="alert">当前账号没有合规设置查看权限。</main>;return <ComplianceSettings canManage={permissions.includes('compliance.manage')}/>;}
