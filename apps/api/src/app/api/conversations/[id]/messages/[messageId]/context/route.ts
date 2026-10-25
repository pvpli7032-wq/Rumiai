import {NextResponse} from 'next/server';
import {requireUser,unauthorized,jsonError,privateHeaders} from '@rumiai/backend/infrastructure/http';
import {setMessageContextIncluded} from '@rumiai/backend/modules/conversations/revisions/versions';
export const dynamic='force-dynamic';
export async function PATCH(request:Request,{params}:{params:Promise<{id:string;messageId:string}>}){const user=await requireUser(request);if(!user)return unauthorized();try{const p=await params;const body=await request.json().catch(()=>null);const result=await setMessageContextIncluded(user.userId,p.id,p.messageId,body?.included);return NextResponse.json(result,{headers:privateHeaders});}catch(error){return jsonError(error,"PATCH /api/conversations/[id]/messages/[messageId]/context","操作失败，请重试。");}}
