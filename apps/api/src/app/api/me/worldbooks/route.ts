import {NextResponse} from 'next/server';
import {requireUser,unauthorized,jsonError,privateHeaders} from '@rumiai/backend/infrastructure/http';
import {listWorldbooks,saveWorldbook} from '@rumiai/backend/modules/worldbooks/service';
export const dynamic='force-dynamic';
export async function GET(request:Request){const user=await requireUser(request);if(!user)return unauthorized();try{const result=await listWorldbooks(user.userId);return NextResponse.json(result,{headers:privateHeaders});}catch(error){return jsonError(error,"GET /api/me/worldbooks","操作失败，请重试。");}}
export async function POST(request:Request){const user=await requireUser(request);if(!user)return unauthorized();try{const body=await request.json().catch(()=>null);const result=await saveWorldbook(user.userId,null,body);return NextResponse.json(result,{headers:privateHeaders});}catch(error){return jsonError(error,"POST /api/me/worldbooks","操作失败，请重试。");}}
