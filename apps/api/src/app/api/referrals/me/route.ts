import {NextResponse} from 'next/server';
import {jsonError, privateHeaders, readJsonBody, requireUser, unauthorized} from '@rumiai/backend/infrastructure/http';
import {readMyReferrals, updateInviteCode} from '@rumiai/backend/modules/referrals/service';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const user = await requireUser(request); if (!user) return unauthorized();
  try { return NextResponse.json(await readMyReferrals(user.userId), {headers: privateHeaders}); }
  catch (error) { return jsonError(error, 'GET /api/referrals/me', '邀请关系读取失败。'); }
}
export async function PATCH(request: Request) {
  const user = await requireUser(request); if (!user) return unauthorized();
  const body = await readJsonBody(request, {maxBytes: 10_000}); if (body.response) return body.response;
  try { return NextResponse.json(await updateInviteCode(user.userId, body.input as never), {headers: privateHeaders}); }
  catch (error) { return jsonError(error, 'PATCH /api/referrals/me', '邀请码更新失败。'); }
}
