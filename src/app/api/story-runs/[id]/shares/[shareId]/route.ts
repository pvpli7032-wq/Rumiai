import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { withdrawStoryShare } from '@/lib/stories/lifecycle/share-service';
import { storyErrorResponse } from '../../../errors';

export const dynamic = 'force-dynamic';

/** W07 data layer only: withdraw a share. The run body is never modified. */
export async function DELETE(request: Request, {params}: {params: Promise<{id: string; shareId: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const {id, shareId} = await params;
    return NextResponse.json(await withdrawStoryShare(auth.userId, id, shareId));
  } catch (error) { return storyErrorResponse(error, 'DELETE /api/story-runs/[id]/shares/[shareId]'); }
}
