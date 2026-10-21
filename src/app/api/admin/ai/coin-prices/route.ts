import {NextResponse} from 'next/server';
import {addAdminCoinPrice, readAdminCoinPrices} from '@/lib/admin/coin-prices-admin';
import {badRequest, forbidden, jsonError, privateHeaders, readJsonBody, requireAdmin, unauthorized} from '@/lib/http';

export const dynamic = 'force-dynamic';

/** 币价历史：每个模型按生效时间倒序，旧版本保留可查。 */
export async function GET(request: Request) {
  const access = await requireAdmin(request, 'ai.costs.read');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备价格查看权限的管理员可以查看模型币价。');
  try {
    return NextResponse.json(await readAdminCoinPrices(), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/ai/coin-prices', '币价读取失败，请稍后重试。');
  }
}

/** 新增一个币价版本：只追加新行，不改历史。 */
export async function POST(request: Request) {
  const access = await requireAdmin(request, 'ai.costs.manage');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备价格保存权限的管理员可以新增模型币价。');
  const body = await readJsonBody(request);
  if (body.response) return body.response;
  if (!body.input || typeof body.input !== 'object' || Array.isArray(body.input)) return badRequest('币价数据格式不正确。');
  try {
    return NextResponse.json(await addAdminCoinPrice(body.input as Record<string, unknown>), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'POST /api/admin/ai/coin-prices', '币价保存失败，请稍后重试。');
  }
}
