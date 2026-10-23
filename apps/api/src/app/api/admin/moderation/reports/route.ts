import {NextResponse} from 'next/server';
import {listModerationReports} from '@rumiai/backend/modules/community/moderation-read-service';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const access = await requireAdmin(request, 'moderation.read');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('此队列仅限审核人员访问。');
  const search = new URL(request.url).searchParams;
  const status = search.get('status') || 'OPEN';
  const take = Math.min(50, Math.max(1, Number(search.get('limit')) || 30));
  try {
    return NextResponse.json(await listModerationReports(status, take), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/moderation/reports', '举报队列加载失败。');
  }
}
