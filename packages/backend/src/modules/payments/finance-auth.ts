import {requireAdmin} from '@rumiai/backend/infrastructure/http/auth';

/** Thin wrapper over the route layer's permission check; the shape is kept for existing callers and tests. */
export async function getFinanceAdmin(request: Request, permission: 'finance.read' | 'finance.packages.write' | 'finance.refunds.request' | 'finance.refunds.approve' | 'finance.refunds.execute' | 'finance.reconciliation.import' = 'finance.read') {
  const access = await requireAdmin(request, permission);
  if (access.ok) return {user: access.user, status: 200, error: ''} as const;
  if (access.reason === 'anonymous') return {user: null, status: 401, error: '请先登录。'} as const;
  return {user: null, status: 403, error: '当前账号没有此财务操作权限。'} as const;
}
