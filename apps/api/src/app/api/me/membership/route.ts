import { NextResponse } from 'next/server';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { privateHeaders, unauthorized } from '@rumiai/backend/infrastructure/http';
import { readMembershipCurrent, readMembershipOrders } from '@rumiai/backend/modules/memberships/service';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  const [membership, orders] = await Promise.all([readMembershipCurrent(user.userId), readMembershipOrders(user.userId)]);
  return NextResponse.json({membership, orders}, {headers: privateHeaders});
}
