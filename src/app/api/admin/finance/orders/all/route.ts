import {NextResponse} from 'next/server';
import {getFinanceAdmin} from '@/lib/payments/finance-auth';
import {listPaymentOrders,PaymentOrderQueryError} from '@/lib/payments/order-management-service';
import {logRouteError} from '@/lib/logger';

export const dynamic='force-dynamic';
export async function GET(request:Request){
  const access=await getFinanceAdmin(request);
  if(!access.user)return NextResponse.json({error:access.error},{status:access.status,headers:{'Cache-Control':'private, no-store'}});
  const params=new URL(request.url).searchParams;
  try{
    const result=await listPaymentOrders({page:params.get('page')??undefined,pageSize:params.get('pageSize')??undefined,status:params.get('status')??undefined,query:params.get('q')??undefined});
    return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){
    if(error instanceof PaymentOrderQueryError)return NextResponse.json({error:error.message},{status:error.status,headers:{'Cache-Control':'private, no-store'}});
    logRouteError('GET /api/admin/finance/orders/all',error);
    return NextResponse.json({error:'订单列表加载失败。'},{status:500,headers:{'Cache-Control':'private, no-store'}});
  }
}
