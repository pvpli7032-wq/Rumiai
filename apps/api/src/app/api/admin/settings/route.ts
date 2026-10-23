import {NextResponse} from 'next/server';
import {SETTING_GROUPS, definitionsOfGroup, isSettingGroup, readGroup, saveGroup} from '@rumiai/backend/modules/settings/index';
import {badRequest, forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';
import {parseChanges, parseExpectedVersions} from './_input';
import {readSettingsJson, settingsErrorResponse} from './_response';

export const dynamic = 'force-dynamic';

/** 设置中心：一次读一组字段、当前值、版本与说明。 */
export async function GET(request: Request) {
  const access = await requireAdmin(request, 'settings.read');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备设置查看权限的管理员可以查看运营设置。');
  const group = new URL(request.url).searchParams.get('group') ?? '';
  if (!isSettingGroup(group)) return badRequest('请选择有效的设置分组，可选：' + SETTING_GROUPS.map(item => item.label).join('、') + '。');
  try {
    const values = await readGroup(group);
    return NextResponse.json({group, values, definitions: definitionsOfGroup(group)}, {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/settings', '设置读取失败，请稍后重试。');
  }
}

/** 保存一组设置：单事务，任何一项版本冲突都整体回滚，不写半条。 */
export async function PATCH(request: Request) {
  const access = await requireAdmin(request, 'settings.write');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备设置保存权限的管理员可以修改运营设置。');
  const body = await readSettingsJson(request);
  if (body.response) return body.response;
  try {
    const input = body.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return badRequest('设置数据格式不正确。');
    const record = input as Record<string, unknown>;
    const group = record.group;
    if (typeof group !== 'string' || !isSettingGroup(group)) return badRequest('请选择有效的设置分组。');
    const changes = parseChanges(record.changes);
    const expectedVersions = parseExpectedVersions(record.expectedVersions);
    const result = await saveGroup({group, changes, expectedVersions, operatorId: access.user.userId});
    return NextResponse.json(result, {headers: privateHeaders});
  } catch (error) {
    return settingsErrorResponse(error, 'PATCH /api/admin/settings');
  }
}
