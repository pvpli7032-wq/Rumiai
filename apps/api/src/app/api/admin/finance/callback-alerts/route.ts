import {NextResponse} from 'next/server';
import {getFinanceAdmin} from '@rumiai/backend/modules/payments/finance-auth';
import {readCallbackAlertSummary} from '@rumiai/backend/modules/payments/callback-alert-service';
import {apiError, jsonError, privateHeaders} from '@rumiai/backend/infrastructure/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const access = await getFinanceAdmin(request);
  if (!access.user) return apiError(access.status, access.error);
  try {
    const hours = new URL(request.url).searchParams.get('hours') ?? undefined;
    return NextResponse.json(await readCallbackAlertSummary(access.user.userId, hours), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/finance/callback-alerts', '支付回调告警暂时不可用。');
  }
}
