import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {retryStoryState} from '@/lib/stories/lifecycle/chapter-service';
import {storyErrorResponse} from '../../../../errors';

export async function POST(request: Request, {params}: {params: Promise<{id: string; turnId: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const body: unknown = await request.json().catch(() => undefined);
    const {id, turnId} = await params;
    const result = await retryStoryState(auth.userId, id, turnId, body);
    return NextResponse.json(result);
  } catch (error) {
    return storyErrorResponse(error, 'POST /api/story-runs/[id]/turns/[turnId]/retry-state');
  }
}
