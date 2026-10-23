import { NextResponse } from 'next/server';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { simulateCoinPurchase, SimulatedPurchaseError } from '@rumiai/backend/modules/payments/purchase-service';

export async function POST(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const result = await simulateCoinPurchase(authUser.userId, body.packageId ?? body.package_id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SimulatedPurchaseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logRouteError('POST /api/coins/purchase', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
