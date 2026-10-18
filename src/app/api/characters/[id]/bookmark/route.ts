import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { bookmarkCharacter, CharacterEngagementError, unbookmarkCharacter } from '@/lib/characters/engagement-service';

export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    return NextResponse.json(await bookmarkCharacter(auth.userId, (await params).id));
  } catch (error) {
    if (error instanceof CharacterEngagementError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('POST /api/characters/[id]/bookmark', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}

export async function DELETE(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    return NextResponse.json(await unbookmarkCharacter(auth.userId, (await params).id));
  } catch (error) {
    if (error instanceof CharacterEngagementError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('DELETE /api/characters/[id]/bookmark', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
