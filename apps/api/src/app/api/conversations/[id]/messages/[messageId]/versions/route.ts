import {NextResponse} from 'next/server';
import {requireUser,unauthorized,jsonError,privateHeaders} from '@rumiai/backend/infrastructure/http';
import {listMessageVersions} from '@rumiai/backend/modules/conversations/revisions/versions';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string;messageId:string}>}){const user=await requireUser(request);if(!user)return unauthorized();try{const p=await params;const result=await listMessageVersions(user.userId,p.id,p.messageId);return NextResponse.json(result,{headers:privateHeaders});}catch(error){return jsonError(error,"GET /api/conversations/[id]/messages/[messageId]/versions","操作失败，请重试。");}}
