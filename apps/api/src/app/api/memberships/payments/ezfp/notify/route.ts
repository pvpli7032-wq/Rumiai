import { NextResponse } from 'next/server';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import { settleMembershipEzfpNotification, MembershipPaymentWorkflowError } from '@rumiai/backend/workflows/membership-purchase';
import {MembershipError} from '@rumiai/backend/modules/memberships/service';
import {MembershipPaymentError} from '@rumiai/backend/modules/payments/membership-provider';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await settleMembershipEzfpNotification(request.url);
    return new NextResponse('success', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (error) {
    if (error instanceof MembershipPaymentWorkflowError || error instanceof MembershipError || error instanceof MembershipPaymentError) return new NextResponse('fail', { status: error.status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    logRouteError('GET /api/memberships/payments/ezfp/notify', error);
    return new NextResponse('fail', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
