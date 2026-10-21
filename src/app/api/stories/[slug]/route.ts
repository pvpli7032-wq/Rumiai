import { NextResponse } from 'next/server';
import { readPublishedStory } from '@/lib/stories/catalog-service';
import { storyErrorResponse } from '../../story-runs/errors';

export async function GET(_request: Request, {params}: {params: Promise<{slug: string}>}) {
  try {
    const {slug} = await params;
    // Envelope matches the documented contract (and the list endpoint's {items, nextCursor}):
    // the entry page reads payload.story.
    return NextResponse.json({story: await readPublishedStory(slug)});
  } catch (error) { return storyErrorResponse(error, 'GET /api/stories/[slug]'); }
}
