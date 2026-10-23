import {NextResponse} from 'next/server';
import {forbidden, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';
import {readSettingsJson, settingsErrorResponse} from '../_response';
import {buildImportDiff, parseImportValues} from '../_transfer';

export const dynamic = 'force-dynamic';

/**
 * 导入预览：只算差异，不写库。
 * 界面据此显示「哪些会改、哪些一样、哪些不认识」，管理员确认后才落库。
 */
export async function POST(request: Request) {
  const access = await requireAdmin(request, 'settings.write');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备设置保存权限的管理员可以导入运营设置。');
  const body = await readSettingsJson(request);
  if (body.response) return body.response;
  try {
    const record = (body.input ?? {}) as Record<string, unknown>;
    const diff = await buildImportDiff(parseImportValues(record.values));
    const counts = {change: 0, same: 0, 'unknown-key': 0};
    for (const row of diff) counts[row.action] += 1;
    return NextResponse.json({items: diff, counts}, {headers: privateHeaders});
  } catch (error) {
    return settingsErrorResponse(error, 'POST /api/admin/settings/import');
  }
}
