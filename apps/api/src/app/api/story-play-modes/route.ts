import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {readStoryPlayModes} from '@rumiai/backend/modules/stories/play-mode-service';
import {storyErrorResponse} from '../story-runs/errors';
export async function GET(request:Request){try{const user=await getAuthUser(request);return NextResponse.json(await readStoryPlayModes(user?.userId??null,new URL(request.url).searchParams.get('characterId')),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return storyErrorResponse(e,'GET story play modes');}}
