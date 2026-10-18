import { NextResponse } from 'next/server';
import { getModerator } from '@/lib/moderator';
import { listModerationReports, ModerationReadError } from '@/lib/community/moderation-read-service';
import { logRouteError } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!await getModerator(request, 'moderation.read')) return NextResponse.json({error: '此队列仅限审核人员访问。'}, {status: 403});
  const search = new URL(request.url).searchParams;
  const status = search.get('status') || 'OPEN';
  const take = Math.min(50, Math.max(1, Number(search.get('limit')) || 30));
  try {
    return NextResponse.json(await listModerationReports(status, take), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    if (error instanceof ModerationReadError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('GET /api/moderation/reports', error);
    return NextResponse.json({error: '举报队列加载失败。'}, {status: 500});
  }
}
