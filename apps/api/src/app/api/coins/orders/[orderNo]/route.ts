import { NextResponse } from 'next/server';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import { getUserPaymentOrderStatus } from '@rumiai/backend/modules/payments/order-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ orderNo: string }> }) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const orderNo = (await context.params).orderNo;
    if (!/^[A-Z0-9]{20,40}$/.test(orderNo)) return NextResponse.json({ error: 'Invalid order number' }, { status: 400 });

    const order = await getUserPaymentOrderStatus(authUser.userId, orderNo);
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    return NextResponse.json(order);
  } catch (error) {
    logRouteError('GET /api/coins/orders/[orderNo]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
