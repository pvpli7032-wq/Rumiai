import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@rumiai/backend/modules/admin-auth/request';
import {MissionManagementError,readManagedMissions,saveManagedMission} from '@rumiai/backend/modules/missions/management-service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};

export async function GET(request:Request){
  const auth=await getAdminRequestUser(request);
  if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  try{return NextResponse.json(await readManagedMissions(auth.userId),{headers});}
  catch(error){
    if(error instanceof MissionManagementError)return NextResponse.json({error:error.message},{status:error.status,headers});
    logRouteError('GET /api/admin/growth/missions',error);return NextResponse.json({error:'任务配置读取失败。'},{status:500,headers});
  }
}

export async function POST(request:Request){
  const auth=await getAdminRequestUser(request);
  if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  let input:unknown;try{input=await request.json();}catch{return NextResponse.json({error:'请求数据格式无效。'},{status:400,headers});}
  try{return NextResponse.json(await saveManagedMission(auth.userId,input),{status:201,headers});}
  catch(error){
    if(error instanceof MissionManagementError)return NextResponse.json({error:error.message},{status:error.status,headers});
    logRouteError('POST /api/admin/growth/missions',error);return NextResponse.json({error:'任务配置保存失败。'},{status:500,headers});
  }
}
