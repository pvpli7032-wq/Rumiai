import {NextResponse} from 'next/server';
import {forbidden, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';
import {saveChanges, SettingValidationError} from '@rumiai/backend/modules/settings/index';
import {parseExpectedVersions} from '../../_input';
import {readSettingsJson, settingsErrorResponse} from '../../_response';
import {buildImportDiff, parseImportValues} from '../../_transfer';

export const dynamic = 'force-dynamic';

/**
 * 导入确认：一次事务写入，走与分组 PATCH 完全相同的 saveChanges。
 *
 * 只写差异里真正变化的值：一样的项不写，避免无意义的版本递增与历史噪音。
 * 只要有一个未登记的键就整批拒绝，不做「部分导入」。
 */
export async function POST(request: Request) {
  const access = await requireAdmin(request, 'settings.write');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备设置保存权限的管理员可以导入运营设置。');
  const body = await readSettingsJson(request);
  if (body.response) return body.response;
  try {
    const record = (body.input ?? {}) as Record<string, unknown>;
    const diff = await buildImportDiff(parseImportValues(record.values));
    const unknown = diff.filter(row => row.action === 'unknown-key').map(row => row.key);
    if (unknown.length) {
      const listed = unknown.slice(0, 5).join('、');
      throw new SettingValidationError(unknown[0], `导入文件包含未登记的设置键：${listed}${unknown.length > 5 ? ' 等' : ''}。整批未写入。`);
    }
    const changes = diff.filter(row => row.action === 'change').map(row => ({key: row.key, value: row.incoming}));
    const result = await saveChanges({
      changes,
      expectedVersions: parseExpectedVersions(record.expectedVersions),
      operatorId: access.user.userId,
    });
    return NextResponse.json({...result, skipped: diff.length - changes.length}, {headers: privateHeaders});
  } catch (error) {
    return settingsErrorResponse(error, 'POST /api/admin/settings/import/confirm');
  }
}
