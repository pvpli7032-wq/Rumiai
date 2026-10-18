import {NextResponse} from 'next/server';
import {getModerator} from '@/lib/moderator';
import {moderateCommunityReport, CommunityModerationError} from '@/lib/community/moderation-service';
import {logRouteError} from '@/lib/logger';
export async function PATCH(request: Request, context: {params: Promise<{id: string}>}) {
  try {
    const actor = await getModerator(request);
    if (!actor) return NextResponse.json({error: '此操作仅限审核人员。'}, {status: 403});
    const result = await moderateCommunityReport(actor.userId, (await context.params).id, await request.json().catch(() => null));
    return NextResponse.json(result, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    if (error instanceof CommunityModerationError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('PATCH /api/admin/moderation/reports/[id]', error);
    return NextResponse.json({error: '举报处置失败。'}, {status: 500});
  }
}
