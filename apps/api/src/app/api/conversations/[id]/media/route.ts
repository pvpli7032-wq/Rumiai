import {NextResponse} from 'next/server';
import {requireUser,unauthorized,privateHeaders,jsonError} from '@rumiai/backend/infrastructure/http';
import {readConversationMediaCapabilities,MediaTaskError} from '@rumiai/backend/modules/conversations/media/task-service';
export async function GET(r:Request,{params}:{params:Promise<{id:string}>}){const user=await requireUser(r);if(!user)return unauthorized();try{return NextResponse.json(await readConversationMediaCapabilities(user.userId,(await params).id),{headers:privateHeaders});}catch(e){return e instanceof MediaTaskError?NextResponse.json({error:e.message,code:e.code},{status:e.status,headers:privateHeaders}):jsonError(e,'media capability','媒体能力读取失败。');}}
