import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@/lib/admin-auth/request';
import {MissionManagementError,saveManagedMission} from '@/lib/missions/management-service';
import {logRouteError} from '@/lib/logger';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};

export async function PATCH(request:Request,{params:paramsPromise}:{params:Promise<{id:string}>}){
  const auth=await getAdminRequestUser(request);
  if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  let input:unknown;try{input=await request.json();}catch{return NextResponse.json({error:'请求数据格式无效。'},{status:400,headers});}
  try{
    const {id}=await paramsPromise;
    return NextResponse.json(await saveManagedMission(auth.userId,{...(input as object),id}),{headers});
  }catch(error){
    if(error instanceof MissionManagementError)return NextResponse.json({error:error.message},{status:error.status,headers});
    logRouteError('PATCH /api/admin/growth/missions/[id]',error);return NextResponse.json({error:'任务配置保存失败。'},{status:500,headers});
  }
}
