import {NextResponse} from 'next/server';
import {getFinanceAdmin} from '@rumiai/backend/modules/payments/finance-auth';
import {importPaymentStatement, listPaymentReconciliationBatches} from '@rumiai/backend/modules/payments/statement-reconciliation-service';
import {apiError, badRequest, jsonError, privateHeaders} from '@rumiai/backend/infrastructure/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const access = await getFinanceAdmin(request);
  if (!access.user) return apiError(access.status, access.error);
  try {
    return NextResponse.json(await listPaymentReconciliationBatches(access.user.userId), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/finance/reconciliation', '渠道对账批次读取失败。');
  }
}

export async function POST(request: Request) {
  const access = await getFinanceAdmin(request, 'finance.reconciliation.import');
  if (!access.user) return apiError(access.status, access.error);
  let input: unknown;
  try { input = await request.json(); } catch { return badRequest('导入请求格式无效。'); }
  try {
    const result = await importPaymentStatement(access.user.userId, input);
    return NextResponse.json(result, {status: result.created ? 201 : 200, headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'POST /api/admin/finance/reconciliation', '渠道对账导入失败，未修改订单或金币。');
  }
}
