import { isIP } from 'node:net';
import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { logRouteError } from '@/lib/logger';
import { createCoinPaymentOrder, PaymentOrderError } from '@/lib/payments/order-service';

export const dynamic = 'force-dynamic';

function requestClientIp(request: Request): string {
  const candidate = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return candidate && isIP(candidate) ? candidate : '127.0.0.1';
}

export async function POST(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: unknown;
    try { body = await request.json(); } catch { body = null; }
    const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const packageId = input.packageId;
    const idempotencyKey = input.idempotencyKey;
    const quote = input.quote as { amountCnyCents?: unknown; coinAmount?: unknown } | undefined;
    if (quote !== undefined && (!quote || typeof quote !== 'object' || !Number.isSafeInteger(quote.amountCnyCents) || !Number.isSafeInteger(quote.coinAmount) || Number(quote.amountCnyCents) < 1 || Number(quote.coinAmount) < 1)) {
      return NextResponse.json({ error: '套餐报价格式无效。' }, { status: 400 });
    }
    if (
      typeof packageId !== 'string' || !packageId ||
      typeof idempotencyKey !== 'string' || !/^[0-9a-f-]{36}$/i.test(idempotencyKey)
    ) {
      return NextResponse.json({ error: 'packageId 或 idempotencyKey 无效。' }, { status: 400 });
    }

    const result = await createCoinPaymentOrder({
      userId: authUser.userId,
      packageId,
      idempotencyKey,
      clientIp: requestClientIp(request),
      quote: quote ? { amountCnyCents: Number(quote.amountCnyCents), coinAmount: Number(quote.coinAmount) } : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PaymentOrderError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    logRouteError('POST /api/coins/orders', error);
    return NextResponse.json({ error: '创建支付订单失败，请稍后重试。' }, { status: 500 });
  }
}
