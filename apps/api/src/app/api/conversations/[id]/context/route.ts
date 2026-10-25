import {NextResponse} from 'next/server';
import {requireUser,unauthorized,jsonError,privateHeaders} from '@rumiai/backend/infrastructure/http';
import {readConversationContextSettings,saveConversationContextSettings} from '@rumiai/backend/modules/conversations/context/settings';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const user=await requireUser(request);if(!user)return unauthorized();try{const p=await params;const result=await readConversationContextSettings(user.userId,p.id);return NextResponse.json(result,{headers:privateHeaders});}catch(error){return jsonError(error,"GET /api/conversations/[id]/context","操作失败，请重试。");}}
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){const user=await requireUser(request);if(!user)return unauthorized();try{const p=await params;const body=await request.json().catch(()=>null);const result=await saveConversationContextSettings(user.userId,p.id,body);return NextResponse.json(result,{headers:privateHeaders});}catch(error){return jsonError(error,"PATCH /api/conversations/[id]/context","操作失败，请重试。");}}
