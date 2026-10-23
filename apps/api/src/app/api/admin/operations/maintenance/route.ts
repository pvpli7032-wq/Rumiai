import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@rumiai/backend/modules/admin-auth/request';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';
import {MaintenancePolicyError,readMaintenancePolicy,saveMaintenancePolicy} from '@rumiai/backend/modules/operations/maintenance-service';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request){
  const auth=await getAdminRequestUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  try{return NextResponse.json(await readMaintenancePolicy(auth.userId),{headers});}
  catch(error){if(error instanceof MaintenancePolicyError)return NextResponse.json({error:error.message},{status:error.status,headers});logRouteError('GET /api/admin/operations/maintenance',error);return NextResponse.json({error:'维护设置读取失败。'},{status:503,headers});}
}
export async function PATCH(request:Request){
  const auth=await getAdminRequestUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  try{return NextResponse.json(await saveMaintenancePolicy(auth.userId,await request.json().catch(()=>null)),{headers});}
  catch(error){if(error instanceof MaintenancePolicyError)return NextResponse.json({error:error.message},{status:error.status,headers});logRouteError('PATCH /api/admin/operations/maintenance',error);return NextResponse.json({error:'维护设置保存失败。'},{status:503,headers});}
}
