import {NextResponse} from 'next/server';
import {requireUser,unauthorized,jsonError,privateHeaders} from '@rumiai/backend/infrastructure/http';
import {listPersonas,savePersona} from '@rumiai/backend/modules/personas/service';
export const dynamic='force-dynamic';
export async function GET(request:Request){const user=await requireUser(request);if(!user)return unauthorized();try{const result=await listPersonas(user.userId);return NextResponse.json(result,{headers:privateHeaders});}catch(error){return jsonError(error,"GET /api/me/personas","操作失败，请重试。");}}
export async function POST(request:Request){const user=await requireUser(request);if(!user)return unauthorized();try{const body=await request.json().catch(()=>null);const result=await savePersona(user.userId,null,body);return NextResponse.json(result,{headers:privateHeaders});}catch(error){return jsonError(error,"POST /api/me/personas","操作失败，请重试。");}}
