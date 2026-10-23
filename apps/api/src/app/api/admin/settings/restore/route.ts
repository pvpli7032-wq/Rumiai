import {NextResponse} from 'next/server';
import {restoreRevision} from '@rumiai/backend/modules/settings/index';
import {badRequest, forbidden, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';
import {isRegisteredKey} from '../_input';
import {readSettingsJson, settingsErrorResponse} from '../_response';

export const dynamic = 'force-dynamic';

const REVISION_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

/** 恢复历史值：生成一个新版本，不改旧记录。 */
export async function POST(request: Request) {
  const access = await requireAdmin(request, 'settings.write');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备设置保存权限的管理员可以恢复历史版本。');
  const body = await readSettingsJson(request);
  if (body.response) return body.response;
  try {
    const input = body.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return badRequest('恢复数据格式不正确。');
    const {key, revisionId} = input as {key?: unknown; revisionId?: unknown};
    if (typeof key !== 'string' || !isRegisteredKey(key)) return badRequest('未登记的设置键。');
    if (typeof revisionId !== 'string' || !REVISION_PATTERN.test(revisionId)) return badRequest('请选择要恢复的历史记录。');
    const result = await restoreRevision({key, revisionId, operatorId: access.user.userId});
    return NextResponse.json(result, {headers: privateHeaders});
  } catch (error) {
    return settingsErrorResponse(error, 'POST /api/admin/settings/restore');
  }
}
