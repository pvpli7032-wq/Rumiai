import {NextResponse} from 'next/server';
import {getFinanceAdmin} from '@/lib/payments/finance-auth';
import {CallbackAlertError,readCallbackAlertSummary} from '@/lib/payments/callback-alert-service';
import {logRouteError} from '@/lib/logger';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request){
  const access=await getFinanceAdmin(request);
  if(!access.user)return NextResponse.json({error:access.error},{status:access.status,headers});
  try{
    const hours=new URL(request.url).searchParams.get('hours')??undefined;
    return NextResponse.json(await readCallbackAlertSummary(access.user.userId,hours),{headers});
  }catch(error){
    if(error instanceof CallbackAlertError)return NextResponse.json({error:error.message},{status:error.status,headers});
    logRouteError('GET /api/admin/finance/callback-alerts',error);return NextResponse.json({error:'支付回调告警暂时不可用。'},{status:500,headers});
  }
}
