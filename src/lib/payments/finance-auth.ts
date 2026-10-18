import { getAuthUser } from '@/lib/auth';
import {hasAdminPermission} from '@/lib/admin/authorization';

export function isFinanceAdmin(userId: string) {
  return hasAdminPermission(userId, 'finance.read');
}

export async function getFinanceAdmin(request: Request, permission: 'finance.read' | 'finance.packages.write' | 'finance.refunds.request' | 'finance.refunds.approve' | 'finance.refunds.execute' | 'finance.reconciliation.import' = 'finance.read') {
  const user = await getAuthUser(request);
  if (!user) return { user: null, status: 401, error: '请先登录。' } as const;
  if (!await hasAdminPermission(user.userId, permission)) return { user: null, status: 403, error: '当前账号没有此财务操作权限。' } as const;
  return { user, status: 200, error: '' } as const;
}
