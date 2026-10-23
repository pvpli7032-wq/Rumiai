import { NextResponse } from 'next/server';
import { logRouteError, logWarning } from '@rumiai/backend/infrastructure/logging/logger';
import { PaymentNotificationError, settleEzfpNotification } from '@rumiai/backend/modules/payments/settlement-service';
import {recordCallbackRejectionSample} from '@rumiai/backend/modules/payments/callback-alert-service';

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
      try{if(await recordCallbackRejectionSample(error.reason))logWarning('ezfp_notify_rejected',{reason:error.reason});}
      catch(monitorError){logRouteError('RECORD /api/coins/payments/ezfp/notify',monitorError);}
      return acknowledge(error.status, 'fail');
    }
    logRouteError('GET /api/coins/payments/ezfp/notify', error);
    return acknowledge(500, 'fail');
  }
}
