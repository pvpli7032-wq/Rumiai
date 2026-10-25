import {NextResponse} from 'next/server';
import {requireUser,unauthorized,jsonError,privateHeaders} from '@rumiai/backend/infrastructure/http';
import {readContextUse} from '@rumiai/backend/modules/conversations/context/builder';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const user=await requireUser(request);if(!user)return unauthorized();try{const p=await params;const result=await readContextUse(user.userId,p.id,new URL(request.url).searchParams.get("requestId")||undefined);return NextResponse.json(result,{headers:privateHeaders});}catch(error){return jsonError(error,"GET /api/conversations/[id]/context/usage","操作失败，请重试。");}}
