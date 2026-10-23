import {NextResponse} from 'next/server';
import {listModerationAudit} from '@rumiai/backend/modules/community/moderation-read-service';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const access = await requireAdmin(request, 'moderation.read');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('审计记录仅限审核人员访问。');
  try {
    return NextResponse.json(await listModerationAudit(), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/moderation/audit', '审计记录加载失败。');
  }
}
