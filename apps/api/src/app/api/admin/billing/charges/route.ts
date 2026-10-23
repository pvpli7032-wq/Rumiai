import {NextResponse} from 'next/server';
import {listAdminCharges} from '@rumiai/backend/modules/admin/charges-admin';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';

export const dynamic = 'force-dynamic';

/** 费用单列表：HELD / UNKNOWN 优先，游标分页。 */
export async function GET(request: Request) {
  const access = await requireAdmin(request, 'billing.read');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备计费查看权限的管理员可以查看费用单。');
  const search = new URL(request.url).searchParams;
  try {
    const page = await listAdminCharges({status: search.get('status'), cursor: search.get('cursor'), limit: search.get('limit')});
    return NextResponse.json(page, {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/billing/charges', '费用单加载失败，请稍后重试。');
  }
}
