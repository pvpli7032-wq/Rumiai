import { NextResponse } from 'next/server';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { readStoryRun } from '@rumiai/backend/modules/stories/repository/run-service';
import { storyErrorResponse } from '../errors';

export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    return NextResponse.json(await readStoryRun(auth.userId, (await params).id));
  } catch (error) { return storyErrorResponse(error, 'GET /api/story-runs/[id]'); }
}
