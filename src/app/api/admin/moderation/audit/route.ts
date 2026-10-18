import { NextResponse } from 'next/server';
import { getModerator } from '@/lib/moderator';
import { listModerationAudit } from '@/lib/community/moderation-read-service';
import { logRouteError } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!await getModerator(request, 'moderation.read')) return NextResponse.json({error: '审计记录仅限审核人员访问。'}, {status: 403});
  try {
    return NextResponse.json(await listModerationAudit(), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    logRouteError('GET /api/admin/moderation/audit', error);
    return NextResponse.json({error: '审计记录加载失败。'}, {status: 500});
  }
}
