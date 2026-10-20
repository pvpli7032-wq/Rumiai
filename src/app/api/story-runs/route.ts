import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { createStoryRun, listStoryRuns } from '@/lib/stories/repository/run-service';
import { storyErrorResponse } from './errors';

export async function GET(request: Request) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const query = new URL(request.url).searchParams;
    return NextResponse.json(await listStoryRuns(auth.userId, {cursor: query.get('cursor'), limit: query.get('limit')}));
  } catch (error) { return storyErrorResponse(error, 'GET /api/story-runs'); }
}

export async function POST(request: Request) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({error: '故事数据格式不正确。', code: 'INVALID_STORY_DATA'}, {status: 422}); }
    const {run, created} = await createStoryRun(auth.userId, body);
    return NextResponse.json({run}, {status: created ? 201 : 200});
  } catch (error) { return storyErrorResponse(error, 'POST /api/story-runs'); }
}
