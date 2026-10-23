import { NextResponse } from 'next/server';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { exportStoryRun } from '@rumiai/backend/modules/stories/lifecycle/export-service';
import { storyErrorResponse } from '../../errors';

export const dynamic = 'force-dynamic';

/** Per-run story export (W07): owner-scoped structured JSON, whitelist projection only. */
export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const archive = await exportStoryRun(auth.userId, (await params).id);
    return new Response(JSON.stringify(archive, null, 2), {headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="xingban-story-${archive.run.id}.json"`,
      'Cache-Control': 'private, no-store',
    }});
  } catch (error) { return storyErrorResponse(error, 'GET /api/story-runs/[id]/export'); }
}
