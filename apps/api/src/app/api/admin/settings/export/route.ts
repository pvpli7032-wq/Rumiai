import {NextResponse} from 'next/server';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';
import {buildExportFile} from '../_transfer';

export const dynamic = 'force-dynamic';

/** 导出公共参数：直接下载一个 JSON 文件，内容只有登记表里的键。 */
export async function GET(request: Request) {
  const access = await requireAdmin(request, 'settings.read');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备设置查看权限的管理员可以导出运营设置。');
  try {
    const file = await buildExportFile();
    return new NextResponse(JSON.stringify(file, null, 2), {
      headers: {
        ...privateHeaders,
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="settings-${file.exportedAt.slice(0, 10)}.json"`,
      },
    });
  } catch (error) {
    return jsonError(error, 'GET /api/admin/settings/export', '导出失败，请稍后重试。');
  }
}
