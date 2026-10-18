import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {AnalyticsReportError,readAnalyticsReport} from '@/lib/analytics/report-service';
import {logRouteError} from '@/lib/logger';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};

export async function GET(request:Request){
  const auth=await getAuthUser(request);
  if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  const daysText=new URL(request.url).searchParams.get('days')??'7';
  if(!/^(?:[1-9]|[1-8][0-9]|90)$/.test(daysText))return NextResponse.json({error:'统计天数必须为 1–90 的整数。'},{status:400,headers});
  try{return NextResponse.json(await readAnalyticsReport(auth.userId,Number(daysText)),{headers});}
  catch(error){
    if(error instanceof AnalyticsReportError)return NextResponse.json({error:error.message},{status:error.status,headers});
    logRouteError('GET /api/admin/analytics',error);
    return NextResponse.json({error:'运营分析读取失败，请稍后重试。'},{status:500,headers});
  }
}
