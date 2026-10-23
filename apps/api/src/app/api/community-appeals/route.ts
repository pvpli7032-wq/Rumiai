import { NextResponse } from 'next/server';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import { CommunityAppealError, listOwnCommunityAppeals, submitCommunityAppeal } from '@rumiai/backend/modules/community/appeal-service';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return NextResponse.json({ error: '请先登录。' }, { status: 401 });
  try {
    const rows = await listOwnCommunityAppeals(auth.userId);
    return NextResponse.json(rows, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    logRouteError('GET /api/community-appeals', error);
    return NextResponse.json({ error: '申诉记录读取失败。' }, { status: 500 });
  }
}
export async function POST(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return NextResponse.json({ error: '请先登录。' }, { status: 401 });
  try {
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: '申诉数据格式不正确。' }, { status: 400 }); }
    const appeal = await submitCommunityAppeal(auth.userId, body);
    return NextResponse.json(appeal, { status: 201 });
  } catch (error) {
    if (error instanceof CommunityAppealError) return NextResponse.json({ error: error.message }, { status: error.status });
    logRouteError('POST /api/community-appeals', error); return NextResponse.json({ error: '申诉提交失败。' }, { status: 500 });
  }
}
