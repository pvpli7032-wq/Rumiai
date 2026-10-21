import {NextResponse} from 'next/server';
import {listAdminMirrorResults} from '@/lib/admin/mirror-results-admin';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@/lib/http';

export const dynamic = 'force-dynamic';

/** 后台「他眼中的你」结果列表：按状态筛选，游标分页。 */
export async function GET(request: Request) {
  const access = await requireAdmin(request, 'mirror.read');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备 Mirror 查看权限的管理员可以查看结果。');
  const search = new URL(request.url).searchParams;
  try {
    const page = await listAdminMirrorResults({status: search.get('status'), cursor: search.get('cursor'), limit: search.get('limit')});
    return NextResponse.json(page, {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/mirror/results', '结果列表加载失败，请稍后重试。');
  }
}
