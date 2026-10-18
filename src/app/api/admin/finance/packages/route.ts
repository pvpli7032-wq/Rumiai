import { NextResponse } from 'next/server';
import { getFinanceAdmin } from '@/lib/payments/finance-auth';
import { readPackageManagement, createManagedPackage, PackageManagementError } from '@/lib/coins/package-management';
import { logRouteError } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const access = await getFinanceAdmin(request);
    if (!access.user) return NextResponse.json({ error: access.error }, { status: access.status });
    return NextResponse.json(await readPackageManagement(), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { logRouteError('GET /api/admin/finance/packages', error); return NextResponse.json({ error: '套餐管理加载失败。' }, { status: 500 }); }
}
export async function POST(request: Request) {
  try {
    const access = await getFinanceAdmin(request, 'finance.packages.write');
    if (!access.user) return NextResponse.json({ error: access.error }, { status: access.status });
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: '套餐数据格式错误。' }, { status: 400 }); }
    return NextResponse.json(await createManagedPackage(access.user.userId, body), { status: 201 });
  } catch (error) {
    if (error instanceof PackageManagementError) return NextResponse.json({ error: error.message }, { status: error.status });
    logRouteError('POST /api/admin/finance/packages', error); return NextResponse.json({ error: '套餐创建失败。' }, { status: 500 });
  }
}
