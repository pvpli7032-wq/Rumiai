import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@/lib/admin-auth/request';
import {CompliancePolicyError,readCompliancePolicy,saveCompliancePolicy} from '@/lib/compliance/policy-service';
import {logRouteError} from '@/lib/logger';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request){
  const auth=await getAdminRequestUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  try{return NextResponse.json(await readCompliancePolicy(auth.userId),{headers});}
  catch(error){if(error instanceof CompliancePolicyError)return NextResponse.json({error:error.message},{status:error.status,headers});logRouteError('GET /api/admin/compliance',error);return NextResponse.json({error:'合规设置读取失败。'},{status:500,headers});}
}
export async function PATCH(request:Request){
  const auth=await getAdminRequestUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  let body:unknown;try{body=await request.json();}catch{return NextResponse.json({error:'合规设置数据格式不正确。'},{status:400,headers});}
  try{return NextResponse.json({policy:await saveCompliancePolicy(auth.userId,body)},{headers});}
  catch(error){if(error instanceof CompliancePolicyError)return NextResponse.json({error:error.message},{status:error.status,headers});logRouteError('PATCH /api/admin/compliance',error);return NextResponse.json({error:'合规设置保存失败。'},{status:500,headers});}
}
