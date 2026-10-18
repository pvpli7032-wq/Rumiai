import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {saveAiProvider} from '@/lib/ai/providers/management-service';
import {privateHeaders,providerErrorResponse,readProviderJson} from '../_response';

export async function PATCH(request:Request,{params:paramsPromise}:{params:Promise<{id:string}>}){try{const auth=await getAuthUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:privateHeaders});const parsed=await readProviderJson(request);if('response'in parsed)return parsed.response;const params=await paramsPromise;return NextResponse.json(await saveAiProvider(auth.userId,{...(parsed.input as object),id:params.id}),{headers:privateHeaders});}catch(error){return providerErrorResponse(error,'PATCH /api/admin/ai/providers/[id]');}}
