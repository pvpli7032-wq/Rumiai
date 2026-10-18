import {NextResponse} from 'next/server';
import {listCommunityAppeals} from '@/lib/community/moderation-read-service';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const access = await requireAdmin(request, 'moderation.read');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('此队列仅限审核人员访问。');
  const status = new URL(request.url).searchParams.get('status') || 'OPEN';
  try {
    return NextResponse.json(await listCommunityAppeals(status), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/moderation/appeals', '申诉队列加载失败。');
  }
}
