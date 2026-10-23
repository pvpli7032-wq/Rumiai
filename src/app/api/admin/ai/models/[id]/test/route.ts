import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@/lib/admin-auth/request';
import {testAiModel} from '@/lib/ai/models/management-service';
import {modelErrorResponse,privateHeaders} from '../../_response';

export async function POST(request:Request,{params:paramsPromise}:{params:Promise<{id:string}>}){try{const auth=await getAdminRequestUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:privateHeaders});const {id}=await paramsPromise;return NextResponse.json(await testAiModel(auth.userId,id),{headers:privateHeaders});}catch(error){return modelErrorResponse(error,'POST /api/admin/ai/models/[id]/test');}}
