import {NextResponse} from 'next/server';
import {requireUser,unauthorized,jsonError,privateHeaders} from '@rumiai/backend/infrastructure/http';
import {createConversationBranch} from '@rumiai/backend/modules/conversations/branches/service';
export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){const user=await requireUser(request);if(!user)return unauthorized();try{const p=await params;const body=await request.json().catch(()=>null);const result=await createConversationBranch(user.userId,p.id,String(body?.messageId||""));return NextResponse.json(result,{headers:privateHeaders});}catch(error){return jsonError(error,"POST /api/conversations/[id]/branches","操作失败，请重试。");}}
