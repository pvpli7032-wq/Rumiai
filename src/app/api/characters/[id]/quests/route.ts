import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { CharacterQuestError, createCharacterQuest, listCharacterQuests } from '@/lib/characters/quest-service';

export const dynamic = 'force-dynamic';

function questError(error: unknown) {
  return error instanceof CharacterQuestError
    ? NextResponse.json({error: error.message}, {status: error.status})
    : null;
}

export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    const {id} = await params;
    return NextResponse.json(await listCharacterQuests(id, auth?.userId));
  } catch (error) {
    const response = questError(error);
    if (response) return response;
    logRouteError('GET /api/characters/[id]/quests', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}

export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const {id} = await params;
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({error: '任务数据格式不正确。'}, {status: 400}); }
    return NextResponse.json(await createCharacterQuest(auth.userId, id, body), {status: 201});
  } catch (error) {
    const response = questError(error);
    if (response) return response;
    logRouteError('POST /api/characters/[id]/quests', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
