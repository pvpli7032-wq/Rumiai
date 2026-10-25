import {NextResponse} from 'next/server';
import {requireUser,unauthorized,jsonError,privateHeaders} from '@rumiai/backend/infrastructure/http';
import {saveWorldbookEntry} from '@rumiai/backend/modules/worldbooks/service';
export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){const user=await requireUser(request);if(!user)return unauthorized();try{const p=await params;const body=await request.json().catch(()=>null);const result=await saveWorldbookEntry(user.userId,p.id,null,body);return NextResponse.json(result,{headers:privateHeaders});}catch(error){return jsonError(error,"POST /api/me/worldbooks/[id]/entries","操作失败，请重试。");}}
