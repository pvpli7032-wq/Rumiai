import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {readOperationsReport,OperationsReportError} from '@/lib/operations/report-service';
import {logRouteError} from '@/lib/logger';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};

export async function GET(request:Request){
  const auth=await getAuthUser(request);
  if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  try{return NextResponse.json(await readOperationsReport(auth.userId),{headers});}
  catch(error){
    if(error instanceof OperationsReportError)return NextResponse.json({error:error.message},{status:error.status,headers});
    logRouteError('GET /api/admin/operations',error);return NextResponse.json({error:'运维状态读取失败。'},{status:500,headers});
  }
}
