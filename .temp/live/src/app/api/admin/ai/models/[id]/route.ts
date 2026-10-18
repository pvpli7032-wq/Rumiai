import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {saveAiModel} from '@/lib/ai/models/management-service';
import {modelErrorResponse,privateHeaders,readModelJson} from '../_response';

export async function PATCH(request:Request,{params:paramsPromise}:{params:Promise<{id:string}>}){try{const auth=await getAuthUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:privateHeaders});const parsed=await readModelJson(request);if('response'in parsed)return parsed.response;const {id}=await paramsPromise;return NextResponse.json(await saveAiModel(auth.userId,{...(parsed.input as object),id}),{headers:privateHeaders});}catch(error){return modelErrorResponse(error,'PATCH /api/admin/ai/models/[id]');}}
