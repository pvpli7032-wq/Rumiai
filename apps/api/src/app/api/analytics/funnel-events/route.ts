import {NextResponse} from 'next/server';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {SceneFunnelError,recordSceneFunnelEvent} from '@rumiai/backend/modules/analytics/scene-funnel-service';

export async function POST(request:Request){
  try{
    const authUser=await getAuthUser(request);
    if(!authUser)return NextResponse.json({error:'Unauthorized'},{status:401});
    const body=await request.json().catch(()=>null);
    if(!body||typeof body!=='object')return NextResponse.json({error:'请求体无效。'},{status:422});
    const {event,conversationId,sceneId}=body as Record<string,unknown>;
    if(typeof event!=='string'||typeof conversationId!=='string'||typeof sceneId!=='string')return NextResponse.json({error:'字段缺失或类型错误。'},{status:422});
    await recordSceneFunnelEvent(authUser.userId,{event,conversationId,sceneId});
    return new Response(null,{status:204});
  }catch(error){
    if(error instanceof SceneFunnelError)return NextResponse.json({error:error.message},{status:error.status});
    logRouteError('POST /api/analytics/funnel-events',error);
    return NextResponse.json({error:'Internal server error'},{status:500});
  }
}
