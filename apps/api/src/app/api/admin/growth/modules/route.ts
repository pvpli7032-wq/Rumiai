import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@rumiai/backend/modules/admin-auth/request';
import {GrowthModuleError,readGrowthModules,saveGrowthModule} from '@rumiai/backend/modules/growth/modules/state-service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
function failure(error:unknown,method:string){
  if(error instanceof GrowthModuleError)return NextResponse.json({error:error.message},{status:error.status,headers});
  logRouteError(`${method} /api/admin/growth/modules`,error);return NextResponse.json({error:'玩法模块请求失败。'},{status:500,headers});
}
export async function GET(request:Request){
  const auth=await getAdminRequestUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  try{return NextResponse.json(await readGrowthModules(auth.userId),{headers});}catch(error){return failure(error,'GET');}
}
export async function PUT(request:Request){
  const auth=await getAdminRequestUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  let input:unknown;try{input=await request.json();}catch{return NextResponse.json({error:'玩法模块数据格式错误。'},{status:400,headers});}
  try{return NextResponse.json(await saveGrowthModule(auth.userId,input),{headers});}catch(error){return failure(error,'PUT');}
}
