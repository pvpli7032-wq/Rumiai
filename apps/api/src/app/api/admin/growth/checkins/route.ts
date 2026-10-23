import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@rumiai/backend/modules/admin-auth/request';
import {CheckinManagementError,readCheckinRules,saveCheckinRules} from '@rumiai/backend/modules/checkins/management-service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};

export async function GET(request:Request){
  const auth=await getAdminRequestUser(request);
  if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  try{return NextResponse.json(await readCheckinRules(auth.userId),{headers});}
  catch(error){
    if(error instanceof CheckinManagementError)return NextResponse.json({error:error.message},{status:error.status,headers});
    logRouteError('GET /api/admin/growth/checkins',error);return NextResponse.json({error:'签到奖励读取失败。'},{status:500,headers});
  }
}

export async function PUT(request:Request){
  const auth=await getAdminRequestUser(request);
  if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  try{return NextResponse.json(await saveCheckinRules(auth.userId,await request.json()),{headers});}
  catch(error){
    if(error instanceof CheckinManagementError)return NextResponse.json({error:error.message},{status:error.status,headers});
    logRouteError('PUT /api/admin/growth/checkins',error);return NextResponse.json({error:'签到奖励保存失败。'},{status:500,headers});
  }
}
