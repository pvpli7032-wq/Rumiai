import { NextResponse } from 'next/server';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { clientIp } from '@rumiai/backend/infrastructure/http/client-ip';
import { createMembershipPayment, MembershipPaymentWorkflowError } from '@rumiai/backend/workflows/membership-purchase';
import {MembershipError} from '@rumiai/backend/modules/memberships/service';
import {MembershipPaymentError} from '@rumiai/backend/modules/payments/membership-provider';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const parsed:unknown = await request.json().catch(() => null);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return NextResponse.json({error:'请求数据格式不正确。'},{status:400});
    const body=parsed as Record<string,unknown>;
    const result = await createMembershipPayment({ userId: user.userId, planCode: typeof body.planCode === 'string' ? body.planCode : '', idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '', paymentMethod: body.paymentMethod, clientIp: clientIp(request) ?? '127.0.0.1' });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof MembershipPaymentWorkflowError || error instanceof MembershipError || error instanceof MembershipPaymentError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: '创建会员支付订单失败，请稍后重试。' }, { status: 500 });
  }
}
