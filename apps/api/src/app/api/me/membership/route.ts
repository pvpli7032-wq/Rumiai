import { NextResponse } from 'next/server';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { privateHeaders, unauthorized } from '@rumiai/backend/infrastructure/http';
import { readMembershipCurrent, readMembershipOrderPage } from '@rumiai/backend/modules/memberships/service';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  const query = new URL(request.url).searchParams;
  try {
    const [membership, page] = await Promise.all([readMembershipCurrent(user.userId), readMembershipOrderPage(user.userId, {cursor: query.get('cursor'), limit: query.get('limit')})]);
    return NextResponse.json({membership, orders: page.items, nextOrderCursor: page.nextCursor}, {headers: privateHeaders});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : '会员订单读取失败。'}, {status: (error as {status?: number})?.status ?? 500, headers: privateHeaders});
  }
}
