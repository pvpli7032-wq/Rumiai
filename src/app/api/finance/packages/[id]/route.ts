import { NextResponse } from 'next/server';
import { getFinanceAdmin } from '@/lib/payments/finance-auth';
import { updateManagedPackage, PackageManagementError } from '@/lib/coins/package-management';
import { logRouteError } from '@/lib/logger';

export async function PUT(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const access = await getFinanceAdmin(request);
    if (!access.user) return NextResponse.json({ error: access.error }, { status: access.status });
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(params.id)) return NextResponse.json({ error: '套餐编号无效。' }, { status: 400 });
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: '套餐数据格式错误。' }, { status: 400 }); }
    return NextResponse.json(await updateManagedPackage(access.user.userId, params.id, body));
  } catch (error) {
    if (error instanceof PackageManagementError) return NextResponse.json({ error: error.message }, { status: error.status });
    logRouteError('PUT /api/finance/packages/[id]', error); return NextResponse.json({ error: '套餐修改失败。' }, { status: 500 });
  }
}
