import {NextResponse} from 'next/server';
import {getModerator} from '@/lib/moderator';
import {readCharacterReviewQueue, CharacterReviewError} from '@/lib/characters/review-service';
import {logRouteError} from '@/lib/logger';
export async function GET(request: Request) {
  try {
    const actor = await getModerator(request, 'moderation.read');
    if (!actor) return NextResponse.json({error: '此页面仅限审核人员访问。'}, {status: 403});
    return NextResponse.json(await readCharacterReviewQueue(actor.userId), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    if (error instanceof CharacterReviewError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('GET moderation characters', error);
    return NextResponse.json({error: '审核列表加载失败。'}, {status: 500});
  }
}
