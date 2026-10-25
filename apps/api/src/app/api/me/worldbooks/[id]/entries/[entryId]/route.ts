import {NextResponse} from 'next/server';
import {requireUser,unauthorized,jsonError,privateHeaders} from '@rumiai/backend/infrastructure/http';
import {saveWorldbookEntry,deleteWorldbookEntry} from '@rumiai/backend/modules/worldbooks/service';
export const dynamic='force-dynamic';
export async function PUT(request:Request,{params}:{params:Promise<{id:string;entryId:string}>}){const user=await requireUser(request);if(!user)return unauthorized();try{const p=await params;const body=await request.json().catch(()=>null);const result=await saveWorldbookEntry(user.userId,p.id,p.entryId,body);return NextResponse.json(result,{headers:privateHeaders});}catch(error){return jsonError(error,"PUT /api/me/worldbooks/[id]/entries/[entryId]","操作失败，请重试。");}}
export async function DELETE(request:Request,{params}:{params:Promise<{id:string;entryId:string}>}){const user=await requireUser(request);if(!user)return unauthorized();try{const p=await params;const result=await deleteWorldbookEntry(user.userId,p.id,p.entryId);return NextResponse.json(result,{headers:privateHeaders});}catch(error){return jsonError(error,"DELETE /api/me/worldbooks/[id]/entries/[entryId]","操作失败，请重试。");}}
