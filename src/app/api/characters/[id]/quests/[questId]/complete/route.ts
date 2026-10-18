import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { CharacterQuestError, claimCharacterQuest } from '@/lib/characters/quest-service';

export async function POST(request: Request, {params}: {params: Promise<{id: string; questId: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const {id, questId} = await params;
    const result = await claimCharacterQuest(auth.userId, id, questId);
    if (!result) return NextResponse.json({error: 'Quest already completed'}, {status: 409});
    return NextResponse.json({success: true, ...result});
  } catch (error) {
    if (error instanceof CharacterQuestError) {
      return NextResponse.json({error: error.message, progress: error.progress, target: error.target}, {status: error.status});
    }
    logRouteError('POST /api/characters/[id]/quests/[questId]/complete', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
