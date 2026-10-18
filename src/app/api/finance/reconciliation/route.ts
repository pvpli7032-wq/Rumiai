import {NextResponse} from 'next/server';
import {getFinanceAdmin} from '@/lib/payments/finance-auth';
import {importPaymentStatement,listPaymentReconciliationBatches,StatementReconciliationError} from '@/lib/payments/statement-reconciliation-service';
import {logRouteError} from '@/lib/logger';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request){
  const access=await getFinanceAdmin(request);
  if(!access.user)return NextResponse.json({error:access.error},{status:access.status,headers});
  try{return NextResponse.json(await listPaymentReconciliationBatches(access.user.userId),{headers});}
  catch(error){if(error instanceof StatementReconciliationError)return NextResponse.json({error:error.message},{status:error.status,headers});logRouteError('GET /api/finance/reconciliation',error);return NextResponse.json({error:'渠道对账批次读取失败。'},{status:500,headers});}
}
export async function POST(request:Request){
  const access=await getFinanceAdmin(request,'finance.reconciliation.import');
  if(!access.user)return NextResponse.json({error:access.error},{status:access.status,headers});
  let input:unknown;try{input=await request.json();}catch{return NextResponse.json({error:'导入请求格式无效。'},{status:400,headers});}
  try{
    const result=await importPaymentStatement(access.user.userId,input);
    return NextResponse.json(result,{status:result.created?201:200,headers});
  }catch(error){if(error instanceof StatementReconciliationError)return NextResponse.json({error:error.message},{status:error.status,headers});logRouteError('POST /api/finance/reconciliation',error);return NextResponse.json({error:'渠道对账导入失败，未修改订单或金币。'},{status:500,headers});}
}
