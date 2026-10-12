import { NextResponse } from 'next/server';
import { logRouteError, logWarning } from '@/lib/logger';
import { PaymentNotificationError, settleEzfpNotification } from '@/lib/payments/settlement-service';

export const dynamic = 'force-dynamic';

function acknowledge(status: number, body: 'success' | 'fail') {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export async function GET(request: Request) {
  try {
    await settleEzfpNotification(request.url);
    return acknowledge(200, 'success');
  } catch (error) {
    if (error instanceof PaymentNotificationError) {
      logWarning('ezfp_notify_rejected', { reason: error.reason });
      return acknowledge(error.status, 'fail');
    }
    logRouteError('GET /api/coins/payments/ezfp/notify', error);
    return acknowledge(500, 'fail');
  }
}
