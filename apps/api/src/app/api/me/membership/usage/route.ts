import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {jsonError, privateHeaders, unauthorized} from '@rumiai/backend/infrastructure/http';
import {readOwnMembershipUsage} from '@rumiai/backend/modules/memberships/service';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  const query = new URL(request.url).searchParams;
  try {
    return NextResponse.json(await readOwnMembershipUsage(user.userId, {orderNo: query.get('orderNo') ?? '', cursor: query.get('cursor'), limit: query.get('limit')}), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/me/membership/usage', '权益使用记录读取失败，请重试。');
  }
}
