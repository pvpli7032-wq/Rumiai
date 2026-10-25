import {NextResponse} from 'next/server';
import {requireUser,unauthorized,jsonError,privateHeaders} from '@rumiai/backend/infrastructure/http';
import {searchConversationMessages} from '@rumiai/backend/modules/conversations/search/service';
export const dynamic='force-dynamic';
export async function GET(request:Request){const user=await requireUser(request);if(!user)return unauthorized();try{const result=await searchConversationMessages(user.userId,new URL(request.url).searchParams.get("q")||"",new URL(request.url).searchParams.get("cursor"));return NextResponse.json(result,{headers:privateHeaders});}catch(error){return jsonError(error,"GET /api/conversations/search","操作失败，请重试。");}}
