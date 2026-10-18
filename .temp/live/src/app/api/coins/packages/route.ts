import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/logger';
import {readCheckoutAvailability} from '@/lib/payments/merchant-config-service';
import { listActiveCoinPackages } from '@/lib/coins/package-service';

/**
 * Reads live data, so it must not be statically prerendered — Next otherwise
 * freezes the build-time response and serves it forever.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const packages = await listActiveCoinPackages();
    const response = NextResponse.json(packages);
    const checkout = await readCheckoutAvailability();
    response.headers.set('X-Checkout-Enabled', String(checkout.enabled));
    response.headers.set('X-Checkout-Reason', checkout.reason);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    logRouteError('GET /api/coins/packages', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
