import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { createStoryShare } from '@/lib/stories/lifecycle/share-service';
import { storyErrorResponse } from '../../errors';

export const dynamic = 'force-dynamic';

/** W07 data layer only: record a share of selected story messages. No front-door here. */
export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({error: '分享数据格式不正确。', code: 'INVALID_SHARE_REQUEST'}, {status: 422}); }
    return NextResponse.json(await createStoryShare(auth.userId, (await params).id, body), {status: 201});
  } catch (error) { return storyErrorResponse(error, 'POST /api/story-runs/[id]/shares'); }
}
