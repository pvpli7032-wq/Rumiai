import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@rumiai/backend/modules/admin-auth/request';
import {SceneFunnelReportError,readSceneFunnelReport} from '@rumiai/backend/modules/analytics/scene-funnel-report-service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};

export async function GET(request:Request){
  const auth=await getAdminRequestUser(request);
  if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  const daysText=new URL(request.url).searchParams.get('days')??'7';
  if(!/^(?:[1-9]|[1-8][0-9]|90)$/.test(daysText))return NextResponse.json({error:'统计天数必须为 1–90 的整数。'},{status:400,headers});
  try{return NextResponse.json(await readSceneFunnelReport(auth.userId,Number(daysText)),{headers});}
  catch(error){
    if(error instanceof SceneFunnelReportError)return NextResponse.json({error:error.message},{status:error.status,headers});
    logRouteError('GET /api/admin/analytics/scene-funnel',error);
    return NextResponse.json({error:'场景漏斗读取失败，请稍后重试。'},{status:500,headers});
  }
}
