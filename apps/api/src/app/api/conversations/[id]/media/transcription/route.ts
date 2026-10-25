import {NextResponse} from 'next/server';
import {requireUser,unauthorized,privateHeaders,jsonError} from '@rumiai/backend/infrastructure/http';
import {executeMediaTask,MediaTaskError} from '@rumiai/backend/modules/conversations/media/task-service';
export async function POST(r:Request,{params}:{params:Promise<{id:string}>}){const user=await requireUser(r);if(!user)return unauthorized();try{return NextResponse.json(await executeMediaTask(user.userId,(await params).id,'AUDIO_TRANSCRIPTION',await r.json(),r.signal),{headers:privateHeaders});}catch(e){return e instanceof MediaTaskError?NextResponse.json({error:e.message,code:e.code},{status:e.status,headers:privateHeaders}):jsonError(e,'media task','媒体处理失败。');}}
