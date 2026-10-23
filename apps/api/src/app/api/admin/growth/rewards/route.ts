import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@rumiai/backend/modules/admin-auth/request';
import {readRewardBudgetReport,RewardBudgetReportError} from '@rumiai/backend/modules/growth/reward-budget-service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};

export async function GET(request:Request){
  const auth=await getAdminRequestUser(request);
  if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers});
  const days=Number(new URL(request.url).searchParams.get('days')??7);
  try{return NextResponse.json(await readRewardBudgetReport(auth.userId,days),{headers});}
  catch(error){
    if(error instanceof RewardBudgetReportError)return NextResponse.json({error:error.message},{status:error.status,headers});
    logRouteError('GET /api/admin/growth/rewards',error);return NextResponse.json({error:'奖励发放统计读取失败。'},{status:500,headers});
  }
}
