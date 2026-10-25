import {NextResponse} from 'next/server';
import {requireUser,unauthorized,privateHeaders} from '@rumiai/backend/infrastructure/http';
import {readStorySuggestionCapability,generateStoryActionSuggestions} from '@rumiai/backend/workflows/story-action-suggestions';
import {ChatSuggestionError} from '@rumiai/backend/modules/conversations/suggestion-service';
import {storyErrorResponse} from '../../errors';
type Context={params:Promise<{id:string}>};
const error=(e:unknown)=>e instanceof ChatSuggestionError?NextResponse.json({error:e.message,code:e.code},{status:e.status,headers:privateHeaders}):storyErrorResponse(e,'story suggestions');
export async function GET(r:Request,c:Context){try{const u=await requireUser(r);if(!u)return unauthorized();return NextResponse.json(await readStorySuggestionCapability(u.userId,(await c.params).id),{headers:privateHeaders});}catch(e){return error(e);}}
export async function POST(r:Request,c:Context){try{const u=await requireUser(r);if(!u)return unauthorized();return NextResponse.json(await generateStoryActionSuggestions(u.userId,(await c.params).id,await r.json(),r.signal),{headers:privateHeaders});}catch(e){return error(e);}}
