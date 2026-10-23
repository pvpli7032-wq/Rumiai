import {NextResponse} from 'next/server';
import {isSettingGroup, readHistory} from '@rumiai/backend/modules/settings/index';
import {badRequest, forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';
import {isRegisteredKey} from '../_input';

export const dynamic = 'force-dynamic';

const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

/** 最近修改：按组或按单键分页，group 与 key 都不给时返回全部设置的历史。 */
export async function GET(request: Request) {
  const access = await requireAdmin(request, 'settings.read');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备设置查看权限的管理员可以查看修改历史。');
  const search = new URL(request.url).searchParams;
  const group = search.get('group') ?? '';
  const key = search.get('key') ?? '';
  const cursor = search.get('cursor') ?? '';
  if (group && !isSettingGroup(group)) return badRequest('请选择有效的设置分组。');
  if (key && !isRegisteredKey(key)) return badRequest('未登记的设置键。');
  if (cursor && !CURSOR_PATTERN.test(cursor)) return badRequest('分页位置无效。');
  try {
    const page = await readHistory({group: isSettingGroup(group) ? group : undefined, key: key || undefined, cursor: cursor || null});
    return NextResponse.json(page, {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/settings/history', '修改历史读取失败，请稍后重试。');
  }
}
