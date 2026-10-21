import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {db, pragmasReady} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';
import {ProductFunnelReportError} from '@/lib/analytics/product-funnel-report-service';
import {parseAudienceTier, readOpsMetrics} from '@/lib/analytics/ops-metrics-report-service';
import {logRouteError} from '@/lib/logger';

export const dynamic = 'force-dynamic';
const headers = {'Cache-Control': 'private, no-store'};

/** 运营统计首轮五项指标；免费/付费按 tier 筛选，天数与 overview 同一上限。 */
export async function GET(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401, headers});
  const params = new URL(request.url).searchParams;
  const daysText = params.get('days') ?? '7';
  if (!/^(?:[1-9]|[1-8][0-9]|90)$/.test(daysText)) return NextResponse.json({error: '统计天数必须为 1–90 的整数。'}, {status: 400, headers});
  const days = Number(daysText);
  try {
    await pragmasReady;
    const report = await db.$transaction(async tx => {
      if (!await hasAdminPermission(auth.userId, 'analytics.read', tx)) throw new ProductFunnelReportError('当前账号没有运营分析权限。', 403);
      const generatedAt = new Date();
      const since = new Date(generatedAt.getTime() - days * 86_400_000);
      return {generatedAt: generatedAt.toISOString(), since: since.toISOString(), days, metrics: await readOpsMetrics(tx, since, generatedAt, parseAudienceTier(params.get('tier')))};
    });
    return NextResponse.json(report, {headers});
  } catch (error) {
    if (error instanceof ProductFunnelReportError) return NextResponse.json({error: error.message}, {status: error.status, headers});
    logRouteError('GET /api/admin/analytics/ops-metrics', error);
    return NextResponse.json({error: '运营统计读取失败，请稍后重试。'}, {status: 500, headers});
  }
}
