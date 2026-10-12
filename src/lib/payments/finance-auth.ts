import { getAuthUser } from '@/lib/auth';

export async function getFinanceAdmin(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return { user: null, status: 401, error: '请先登录。' } as const;
  const admins = (process.env.PAYMENT_ADMIN_USER_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean);
  if (!admins.includes(user.userId)) return { user: null, status: 403, error: '仅财务管理员可操作。' } as const;
  return { user, status: 200, error: '' } as const;
}
