import {NextResponse} from 'next/server';
import {getFinanceAdmin} from '@rumiai/backend/modules/payments/finance-auth';
import {readPackageManagement, createManagedPackage} from '@rumiai/backend/modules/coins/package-management';
import {apiError, badRequest, jsonError, privateHeaders} from '@rumiai/backend/infrastructure/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const access = await getFinanceAdmin(request);
    if (!access.user) return apiError(access.status, access.error);
    return NextResponse.json(await readPackageManagement(), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/finance/packages', '套餐管理加载失败。');
  }
}

export async function POST(request: Request) {
  try {
    const access = await getFinanceAdmin(request, 'finance.packages.write');
    if (!access.user) return apiError(access.status, access.error);
    let body: unknown;
    try { body = await request.json(); } catch { return badRequest('套餐数据格式错误。'); }
    return NextResponse.json(await createManagedPackage(access.user.userId, body), {status: 201, headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'POST /api/admin/finance/packages', '套餐创建失败。');
  }
}
