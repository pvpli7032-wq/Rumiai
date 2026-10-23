import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {resumeStory} from '@rumiai/backend/modules/stories/lifecycle/chapter-service';
import {storyErrorResponse} from '../../errors';

export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const body: unknown = await request.json().catch(() => undefined);
    const result = await resumeStory(auth.userId, (await params).id, body);
    return NextResponse.json(result);
  } catch (error) {
    return storyErrorResponse(error, 'POST /api/story-runs/[id]/resume');
  }
}
