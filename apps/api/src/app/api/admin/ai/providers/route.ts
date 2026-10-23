import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@rumiai/backend/modules/admin-auth/request';
import {readAiProviders,saveAiProvider} from '@rumiai/backend/modules/ai/providers/management-service';
import {privateHeaders,providerErrorResponse,readProviderJson} from './_response';

export async function GET(request:Request){try{const auth=await getAdminRequestUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:privateHeaders});return NextResponse.json(await readAiProviders(auth.userId),{headers:privateHeaders});}catch(error){return providerErrorResponse(error,'GET /api/admin/ai/providers');}}
export async function POST(request:Request){try{const auth=await getAdminRequestUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:privateHeaders});const parsed=await readProviderJson(request);if('response'in parsed)return parsed.response;return NextResponse.json(await saveAiProvider(auth.userId,parsed.input),{status:201,headers:privateHeaders});}catch(error){return providerErrorResponse(error,'POST /api/admin/ai/providers');}}
