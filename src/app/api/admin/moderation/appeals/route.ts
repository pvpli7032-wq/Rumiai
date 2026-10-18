import { NextResponse } from 'next/server';
import { getModerator } from '@/lib/moderator';
import { listCommunityAppeals, ModerationReadError } from '@/lib/community/moderation-read-service';
import { logRouteError } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!await getModerator(request, 'moderation.read')) return NextResponse.json({error: '此队列仅限审核人员访问。'}, {status: 403});
  const status = new URL(request.url).searchParams.get('status') || 'OPEN';
  try {
    return NextResponse.json(await listCommunityAppeals(status), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    if (error instanceof ModerationReadError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('GET /api/admin/moderation/appeals', error);
    return NextResponse.json({error: '申诉队列加载失败。'}, {status: 500});
  }
}
