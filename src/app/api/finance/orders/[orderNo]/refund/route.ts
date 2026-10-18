import { NextResponse } from 'next/server';
import { getFinanceAdmin } from '@/lib/payments/finance-auth';
import { PaymentRefundError, requestFullPaymentRefund, approveFullPaymentRefund, rejectFullPaymentRefund, retryFullPaymentRefund, verifyPaymentRefund } from '@/lib/payments/refund-service';
import { logRouteError } from '@/lib/logger';

export const dynamic = 'force-dynamic';
const headers={'Cache-Control':'private, no-store'};

export async function POST(request: Request, context: { params: Promise<{ orderNo: string }> }) {
  const orderNo = (await context.params).orderNo;
  if (!/^[A-Z0-9]{20,40}$/.test(orderNo)) return NextResponse.json({ error: '订单号格式不正确。' }, { status: 400,headers });
  try {
    const body = await request.json().catch(() => null);
    const action=body?.action;
    const permission=action==='request'||action==='refund'?'finance.refunds.request':action==='approve'||action==='reject'?'finance.refunds.approve':action==='verify'||action==='retry'?'finance.refunds.execute':null;
    if(!permission)return NextResponse.json({error:'操作不正确。'},{status:400,headers});
    const access=await getFinanceAdmin(request,permission);
    if(!access.user)return NextResponse.json({error:access.error},{status:access.status,headers});
    if(action==='verify')return NextResponse.json(await verifyPaymentRefund(orderNo),{headers});
    if(action==='approve')return NextResponse.json(await approveFullPaymentRefund(orderNo,access.user.userId,body.reason),{headers});
    if(action==='reject')return NextResponse.json(await rejectFullPaymentRefund(orderNo,access.user.userId,body.reason),{headers});
    if(action==='retry')return NextResponse.json(await retryFullPaymentRefund(orderNo,access.user.userId),{headers});
    const result=await requestFullPaymentRefund(orderNo,access.user.userId,body.reason);
    return NextResponse.json(result,{status:201,headers});
  } catch (error) {
    if (error instanceof PaymentRefundError) return NextResponse.json({ error: error.message }, { status: error.status,headers });
    logRouteError('POST /api/finance/orders/[orderNo]/refund', error);
    return NextResponse.json({ error: '退款操作失败，请查看订单状态。' }, { status: 500,headers });
  }
}
