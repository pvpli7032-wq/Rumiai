import {NextResponse} from 'next/server';
import {getFinanceAdmin} from '@/lib/payments/finance-auth';
import {readPaymentReconciliationBatch} from '@/lib/payments/statement-reconciliation-service';
import {apiError, jsonError, privateHeaders} from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  const access = await getFinanceAdmin(request);
  if (!access.user) return apiError(access.status, access.error);
  const search = new URL(request.url).searchParams;
  try {
    return NextResponse.json(await readPaymentReconciliationBatch(access.user.userId, (await params).id, {page: search.get('page') ?? undefined, pageSize: search.get('pageSize') ?? undefined}), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/finance/reconciliation/[id]', '对账明细读取失败。');
  }
}
