import { NextResponse } from 'next/server';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { exportAccountData } from '@rumiai/backend/modules/accounts/data-export';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ error: '请先登录。' }, { status: 401 });
    const archive = await exportAccountData(auth.userId);
    if (!archive) return NextResponse.json({ error: '账号不存在。' }, { status: 404 });
    return NextResponse.json(archive, { headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'attachment; filename="xingban-account-data.json"',
    } });
  } catch (error) {
    logRouteError('GET /api/users/me/export', error);
    return NextResponse.json({ error: '数据导出失败，请稍后重试。' }, { status: 500 });
  }
}
