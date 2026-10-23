import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@rumiai/backend/modules/admin-auth/request';
import {testAiProvider} from '@rumiai/backend/modules/ai/providers/management-service';
import {privateHeaders,providerErrorResponse} from '../../_response';

export async function POST(request:Request,{params:paramsPromise}:{params:Promise<{id:string}>}){try{const auth=await getAdminRequestUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:privateHeaders});const {id}=await paramsPromise;return NextResponse.json(await testAiProvider(auth.userId,id),{headers:privateHeaders});}catch(error){return providerErrorResponse(error,'POST /api/admin/ai/providers/[id]/test');}}
