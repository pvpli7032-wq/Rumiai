import {NextResponse} from 'next/server';
import {requireUser,unauthorized,jsonError,privateHeaders} from '@rumiai/backend/infrastructure/http';
import {savePersona,deletePersona} from '@rumiai/backend/modules/personas/service';
export const dynamic='force-dynamic';
export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){const user=await requireUser(request);if(!user)return unauthorized();try{const p=await params;const body=await request.json().catch(()=>null);const result=await savePersona(user.userId,p.id,body);return NextResponse.json(result,{headers:privateHeaders});}catch(error){return jsonError(error,"PUT /api/me/personas/[id]","操作失败，请重试。");}}
export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){const user=await requireUser(request);if(!user)return unauthorized();try{const p=await params;const result=await deletePersona(user.userId,p.id);return NextResponse.json(result,{headers:privateHeaders});}catch(error){return jsonError(error,"DELETE /api/me/personas/[id]","操作失败，请重试。");}}
