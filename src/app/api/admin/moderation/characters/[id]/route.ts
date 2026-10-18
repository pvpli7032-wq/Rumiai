import {NextResponse} from 'next/server';
import {getModerator} from '@/lib/moderator';
import {reviewCharacter, CharacterReviewError} from '@/lib/characters/review-service';
import {logRouteError} from '@/lib/logger';
export async function PUT(request: Request, context: {params: Promise<{id: string}>}) {
  try {
    const actor = await getModerator(request);
    if (!actor) return NextResponse.json({error: '此操作仅限审核人员。'}, {status: 403});
    return NextResponse.json(await reviewCharacter(actor.userId, (await context.params).id, await request.json().catch(() => null)), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    if (error instanceof CharacterReviewError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('PUT /api/admin/moderation/characters/[id]', error);
    return NextResponse.json({error: '审核保存失败，请稍后重试。'}, {status: 500});
  }
}
