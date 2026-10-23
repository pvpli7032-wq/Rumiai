import { NextResponse } from 'next/server';
import { listPublishedStories } from '@rumiai/backend/modules/stories/catalog-service';
import { storyErrorResponse } from '../story-runs/errors';

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    return NextResponse.json(await listPublishedStories({locale: query.get('locale'), cursor: query.get('cursor'), limit: query.get('limit')}));
  } catch (error) { return storyErrorResponse(error, 'GET /api/stories'); }
}
