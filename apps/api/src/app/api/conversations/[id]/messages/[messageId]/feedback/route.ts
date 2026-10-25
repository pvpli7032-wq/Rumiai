import {NextResponse} from 'next/server';
import {requireUser,unauthorized,jsonError,privateHeaders} from '@rumiai/backend/infrastructure/http';
import {recordMessageFeedback} from '@rumiai/backend/modules/conversations/revisions/versions';
export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{id:string;messageId:string}>}){const user=await requireUser(request);if(!user)return unauthorized();try{const p=await params;const body=await request.json().catch(()=>null);const result=await recordMessageFeedback(user.userId,p.id,p.messageId,body?.reason);return NextResponse.json(result,{headers:privateHeaders});}catch(error){return jsonError(error,"POST /api/conversations/[id]/messages/[messageId]/feedback","操作失败，请重试。");}}
