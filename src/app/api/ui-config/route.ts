import {NextResponse} from 'next/server';
import {readPublicUiConfig} from '@/lib/settings';
import {logRouteError} from '@/lib/logger';
import {privateHeaders} from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * 前台公开配置：只有 service 里 PUBLIC_KEYS 白名单的项，不含任何后台内部键
 * （成本、毛利、任务、审核、密钥类设置一律不出现）。
 */
export async function GET() {
  try {
    return NextResponse.json(await readPublicUiConfig(), {headers: privateHeaders});
  } catch (error) {
    logRouteError('GET /api/ui-config', error);
    return NextResponse.json({error: '前台配置读取失败，请稍后重试。', code: 'INTERNAL'}, {status: 500, headers: privateHeaders});
  }
}
