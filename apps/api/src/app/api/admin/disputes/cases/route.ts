import {NextResponse} from 'next/server';
import {listAdminDisputeCases} from '@rumiai/backend/modules/admin/dispute-cases-admin';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';

export const dynamic = 'force-dynamic';

/** 后台评理案例列表：状态、票数、截止时间与最近失败原因。 */
export async function GET(request: Request) {
  const access = await requireAdmin(request, 'disputes.read');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备评理查看权限的管理员可以查看案例。');
  const search = new URL(request.url).searchParams;
  try {
    const page = await listAdminDisputeCases({status: search.get('status'), cursor: search.get('cursor'), limit: search.get('limit')});
    return NextResponse.json(page, {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/disputes/cases', '评理案例加载失败，请稍后重试。');
  }
}
