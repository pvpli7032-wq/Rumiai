import { NextResponse } from 'next/server';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { jsonError, privateHeaders, unauthorized } from '@rumiai/backend/infrastructure/http';
import { quoteMembershipRefundForUser } from '@rumiai/backend/modules/memberships/service';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  try {
    const orderNo = new URL(request.url).searchParams.get('orderNo');
    if (!orderNo) return NextResponse.json({error: '缺少会员订单号。'}, {status: 400, headers: privateHeaders});
    return NextResponse.json(await quoteMembershipRefundForUser(user.userId, orderNo), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/me/membership/refund-preview', '读取会员退款预览失败，请稍后重试。');
  }
}
