import {NextResponse} from 'next/server';
import {getFinanceAdmin} from '@/lib/payments/finance-auth';
import {readPaymentReconciliationBatch,StatementReconciliationError} from '@/lib/payments/statement-reconciliation-service';
import {logRouteError} from '@/lib/logger';

export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const access=await getFinanceAdmin(request);
  if(!access.user)return NextResponse.json({error:access.error},{status:access.status,headers:{'Cache-Control':'private, no-store'}});
  const search=new URL(request.url).searchParams;
  try{return NextResponse.json(await readPaymentReconciliationBatch(access.user.userId,(await params).id,{page:search.get('page')??undefined,pageSize:search.get('pageSize')??undefined}),{headers:{'Cache-Control':'private, no-store'}});}
  catch(error){if(error instanceof StatementReconciliationError)return NextResponse.json({error:error.message},{status:error.status,headers:{'Cache-Control':'private, no-store'}});logRouteError('GET /api/admin/finance/reconciliation/[id]',error);return NextResponse.json({error:'对账明细读取失败。'},{status:500,headers:{'Cache-Control':'private, no-store'}});}
}
