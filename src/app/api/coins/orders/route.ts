import { isIP } from 'node:net';
import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { logRouteError } from '@/lib/logger';
import { createCoinPaymentOrder, PaymentOrderError } from '@/lib/payments/order-service';

export const dynamic = 'force-dynamic';

/** 支付渠道只接受公网客户端 IP；内网/回环地址会让网关回一个含糊的「系统异常」。 */
function isPublicIp(value: string): boolean {
  if (value === '::1') return false;
  if (value.startsWith('::ffff:')) return isPublicIp(value.slice(7));
  const v4 = value.split('.').map(Number);
  if (v4.length === 4 && v4.every(part => Number.isInteger(part))) {
    const [a, b] = v4;
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  // 其余合法 IPv6 视为公网，链路本地与唯一本地地址除外。
  const lower = value.toLowerCase();
  return isIP(value) === 6 && !lower.startsWith('fe80') && !lower.startsWith('fc') && !lower.startsWith('fd');
}

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
    const clientIp = requestClientIp(request);
    // 生产环境必须拿到公网 IP，否则渠道会拒绝下单；直接说清原因，别把网关的
    // 「系统异常无法完成付款」丢给用户。
    if (process.env.NODE_ENV === 'production' && !isPublicIp(clientIp)) {
      return NextResponse.json({error: '无法识别你的公网 IP，暂时不能创建支付订单。请检查反向代理是否透传 X-Real-IP。', code: 'CLIENT_IP_UNAVAILABLE'}, {status: 400});
    }
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
      clientIp,
      paymentMethod: input.paymentMethod,
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
