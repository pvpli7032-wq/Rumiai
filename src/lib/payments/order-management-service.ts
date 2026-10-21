import {db,pragmasReady} from '@/lib/db';
import {parseUtcDayRange} from '@/lib/admin/management-service';

export const PAYMENT_ORDER_STATUSES=['PENDING','PAID','REFUND_PENDING','REFUNDED','FAILED'] as const;
export type PaymentOrderStatus=typeof PAYMENT_ORDER_STATUSES[number];
export const PAYMENT_ORDER_EXPORT_LIMIT=5000;

export class PaymentOrderQueryError extends Error{
  constructor(message:string,public status=400){super(message);this.name='PaymentOrderQueryError';}
}

export function parsePaymentOrderQuery(input:{page?:unknown;pageSize?:unknown;status?:unknown;query?:unknown;from?:unknown;until?:unknown}){
  const page=input.page===undefined?1:Number(input.page);
  const pageSize=input.pageSize===undefined?25:Number(input.pageSize);
  const status=input.status===undefined||input.status==='ALL'?'ALL':input.status;
  const query=input.query===undefined?'':input.query;
  if(!Number.isInteger(page)||page<1||page>100000)throw new PaymentOrderQueryError('页码格式无效。');
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw new PaymentOrderQueryError('每页数量必须为 1–100。');
  if(status!=='ALL'&&(typeof status!=='string'||!PAYMENT_ORDER_STATUSES.includes(status as PaymentOrderStatus)))throw new PaymentOrderQueryError('订单状态筛选值无效。');
  if(typeof query!=='string'||query.length>80||query.trim().length>80||query.trim()&&!/^[A-Za-z0-9_-]+$/.test(query.trim()))throw new PaymentOrderQueryError('订单号或渠道单号格式无效。');
  // 日期按订单创建时间（createdAt）筛，UTC 日边界，含结束日期当天 —— 与操作审计同一口径。
  const created=parseUtcDayRange(
    typeof input.from==='string'?input.from:'',typeof input.until==='string'?input.until:'',
    '订单日期',message=>new PaymentOrderQueryError(message),
  );
  return {page,pageSize,status:status as PaymentOrderStatus|'ALL',query:query.trim(),created};
}

/** Read-only operations projection. It never returns account credentials or message data. */
export async function listPaymentOrders(input:{page?:unknown;pageSize?:unknown;status?:unknown;query?:unknown;from?:unknown;until?:unknown}){
  const filter=parsePaymentOrderQuery(input);
  await pragmasReady;
  const where={
    ...(filter.status==='ALL'?{}:{status:filter.status}),
    ...(filter.created.gte||filter.created.lt?{createdAt:filter.created}:{}),
    ...(filter.query?{
      OR:[
        {orderNo:{contains:filter.query}},
        {providerTradeNo:{contains:filter.query}},
      ],
    }:{}),
  };
  const [total,rows]=await Promise.all([
    db.paymentOrder.count({where}),
    db.paymentOrder.findMany({
      where,
      orderBy:[{createdAt:'desc'},{id:'desc'}],
      skip:(filter.page-1)*filter.pageSize,
      take:filter.pageSize,
      select:{
        orderNo:true,status:true,provider:true,providerTradeNo:true,currency:true,
        amountCnyCents:true,packageCoins:true,packageBonus:true,coinAmount:true,
        createdAt:true,paidAt:true,
        refund:{select:{refundNo:true,status:true,amountCnyCents:true,coinAmount:true,errorCode:true,createdAt:true,completedAt:true}},
        callbackEvents:{orderBy:[{receivedAt:'desc'},{id:'desc'}],take:5,select:{provider:true,providerTradeNo:true,outcome:true,reasonCode:true,receivedAt:true}},
      },
    }),
  ]);
  return {
    page:filter.page,
    pageSize:filter.pageSize,
    total,
    items:rows.map(({refund,...order})=>({
      ...order,
      refund:refund?{
        refundNo:refund.refundNo,status:refund.status,amountCnyCents:refund.amountCnyCents,
        coinAmount:refund.coinAmount,errorCode:refund.errorCode,
        createdAt:refund.createdAt,completedAt:refund.completedAt,
      }:null,
    })),
  };
}

/** Bounded export using the same validated filters and an explicit finance-only projection. */
export async function exportPaymentOrders(input:{status?:unknown;query?:unknown}){
  const filter=parsePaymentOrderQuery({...input,page:1,pageSize:1});
  await pragmasReady;
  const where={
    ...(filter.status==='ALL'?{}:{status:filter.status}),
    ...(filter.query?{OR:[{orderNo:{contains:filter.query}},{providerTradeNo:{contains:filter.query}}]}:{}),
  };
  const rows=await db.paymentOrder.findMany({
    where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:PAYMENT_ORDER_EXPORT_LIMIT+1,
    select:{
      orderNo:true,status:true,provider:true,providerTradeNo:true,currency:true,
      amountCnyCents:true,packageCoins:true,packageBonus:true,coinAmount:true,createdAt:true,paidAt:true,
      refund:{select:{refundNo:true,status:true}},
    },
  });
  if(rows.length>PAYMENT_ORDER_EXPORT_LIMIT)throw new PaymentOrderQueryError(`导出结果超过 ${PAYMENT_ORDER_EXPORT_LIMIT} 笔，请缩小筛选范围。`,413);
  return rows;
}

