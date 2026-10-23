import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@rumiai/backend/modules/admin-auth/request';
import {readOperationsReport,OperationsReportError} from '@rumiai/backend/modules/operations/report-service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};

export async function GET(request:Request){
  const auth=await getAdminRequestUser(request);
  if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  try{return NextResponse.json(await readOperationsReport(auth.userId),{headers});}
  catch(error){
    if(error instanceof OperationsReportError)return NextResponse.json({error:error.message},{status:error.status,headers});
    logRouteError('GET /api/admin/operations',error);return NextResponse.json({error:'运维状态读取失败。'},{status:500,headers});
  }
}
