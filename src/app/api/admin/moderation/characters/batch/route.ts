import {NextResponse} from 'next/server';
import {getModerator} from '@/lib/moderator';
import {reviewCharacters, CharacterReviewError} from '@/lib/characters/review-service';
import {logRouteError} from '@/lib/logger';
export async function POST(request: Request) {
  try {
    const actor = await getModerator(request);
    if (!actor) return NextResponse.json({error: '此操作仅限审核人员。'}, {status: 403});
    return NextResponse.json(await reviewCharacters(actor.userId, await request.json().catch(() => null)), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    if (error instanceof CharacterReviewError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('POST /api/admin/moderation/characters/batch', error);
    return NextResponse.json({error: '批量审核失败，请稍后重试。'}, {status: 500});
  }
}
