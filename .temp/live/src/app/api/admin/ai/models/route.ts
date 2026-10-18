import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {readAiModels,saveAiModel} from '@/lib/ai/models/management-service';
import {modelErrorResponse,privateHeaders,readModelJson} from './_response';

export async function GET(request:Request){try{const auth=await getAuthUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:privateHeaders});return NextResponse.json(await readAiModels(auth.userId),{headers:privateHeaders});}catch(error){return modelErrorResponse(error,'GET /api/admin/ai/models');}}
export async function POST(request:Request){try{const auth=await getAuthUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:privateHeaders});const parsed=await readModelJson(request);if('response'in parsed)return parsed.response;return NextResponse.json(await saveAiModel(auth.userId,parsed.input),{status:201,headers:privateHeaders});}catch(error){return modelErrorResponse(error,'POST /api/admin/ai/models');}}
