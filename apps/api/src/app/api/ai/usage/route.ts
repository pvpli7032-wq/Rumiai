import { NextResponse } from 'next/server';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { readAiUsage } from '@rumiai/backend/modules/ai/ai-usage';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const user=await getAuthUser(request);if(!user)return NextResponse.json({error:'请先登录。'},{status:401});
 try{return NextResponse.json(await readAiUsage(user.userId));}catch(error){logRouteError('GET /api/ai/usage',error);return NextResponse.json({error:'AI 用量加载失败。'},{status:500});}
}
