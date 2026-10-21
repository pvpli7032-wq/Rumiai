import { db } from '@/lib/db';
import { parseCnyCents, uniqueUrlParams, verifyEzfpParams } from './ezfp-v2';
import {resolveOrderPaymentConfiguration} from './merchant-config-service';
import {notifyCoinsReceived} from '@/lib/notifications/write';
import {notifySafely} from '@/lib/notifications/emit';

export class PaymentNotificationError extends Error {
  constructor(message: string, readonly reason: string, readonly status = 400) {
    super(message);
    this.name = 'PaymentNotificationError';
  }
}

function reject(reason: string, status = 400): never {
  throw new PaymentNotificationError('支付通知验证失败。', reason, status);
}

async function rejectVerifiedCallback(orderId:string,tradeNo:string,reasonCode:string):Promise<never>{
  await db.paymentCallbackEvent.create({data:{
    paymentOrderId:orderId,provider:'EZFP',providerTradeNo:tradeNo,outcome:'REJECTED',reasonCode,
  }});
  reject(reasonCode);
}

export async function settleEzfpNotification(callbackUrl: string): Promise<{ duplicate: boolean }> {
  const params = uniqueUrlParams(new URL(callbackUrl));
  if (!params) reject('duplicate_fields');
  if (!params.out_trade_no || !params.trade_no || !params.money) {
    reject('required_fields_or_status');
  }

  const order = await db.paymentOrder.findUnique({ where: { orderNo: params.out_trade_no } });
  if (!order || order.provider !== 'EZFP' || order.currency !== 'CNY') reject('order_not_found');
  let config;try{config=await resolveOrderPaymentConfiguration(order.merchantRevisionId);}catch{reject('provider_config_missing',503);}
  if (params.sign_type !== 'RSA' || !/^\d{10}$/.test(params.timestamp || '') || !verifyEzfpParams(params, config.publicKey)) reject('signature_or_timestamp');
  if (params.pid !== config.pid || params.trade_status !== 'TRADE_SUCCESS') await rejectVerifiedCallback(order.id,params.trade_no,'required_fields_or_status');
  if (parseCnyCents(params.money) !== order.amountCnyCents) await rejectVerifiedCallback(order.id,params.trade_no,'amount_mismatch');
  if (order.providerTradeNo && order.providerTradeNo !== params.trade_no) await rejectVerifiedCallback(order.id,params.trade_no,'provider_order_mismatch');
  if (order.status === 'PAID') {
    if (order.providerTradeNo === params.trade_no) {
      await db.paymentCallbackEvent.create({data:{
        paymentOrderId:order.id,provider:'EZFP',providerTradeNo:params.trade_no,outcome:'DUPLICATE',
      }});
      return { duplicate: true };
    }
    await rejectVerifiedCallback(order.id,params.trade_no,'paid_order_trade_mismatch');
  }
  if (order.status !== 'PENDING') await rejectVerifiedCallback(order.id,params.trade_no,'order_not_pending');

  const settled = await db.$transaction(async (tx) => {
    const changed = await tx.paymentOrder.updateMany({
      where: { id: order.id, status: 'PENDING' },
      data: { status: 'PAID', providerTradeNo: params.trade_no, paidAt: new Date() },
    });
    if (changed.count === 0) {
      const current = await tx.paymentOrder.findUnique({ where: { id: order.id }, select: { status: true, providerTradeNo: true } });
      if (current?.status === 'PAID' && current.providerTradeNo === params.trade_no) {
        await tx.paymentCallbackEvent.create({data:{
          paymentOrderId:order.id,provider:'EZFP',providerTradeNo:params.trade_no,outcome:'DUPLICATE',
        }});
        return {outcome:'DUPLICATE' as const};
      }
      const reasonCode=current?.status==='PAID'?'paid_order_trade_mismatch':'order_not_pending';
      await tx.paymentCallbackEvent.create({data:{
        paymentOrderId:order.id,provider:'EZFP',providerTradeNo:params.trade_no,outcome:'REJECTED',reasonCode,
      }});
      return {outcome:'REJECTED' as const,reasonCode};
    }
    await tx.user.update({ where: { id: order.userId }, data: { coins: { increment: order.coinAmount } } });
    const ledger = await tx.coinTransaction.create({
      data: {
        userId: order.userId,
        paymentOrderId: order.id,
        sourceKey: 'PAYMENT_PURCHASE',
        amount: order.coinAmount,
        type: 'PURCHASE',
        description: `EZFP 充值订单 ${order.orderNo}`,
      },
      select: { id: true },
    });
    await tx.paymentCallbackEvent.create({data:{
      paymentOrderId:order.id,provider:'EZFP',providerTradeNo:params.trade_no,outcome:'SETTLED',
    }});
    return {outcome:'SETTLED' as const,ledgerId:ledger.id,userId:order.userId,coins:order.coinAmount,orderNo:order.orderNo};
  });

  if(settled.outcome==='REJECTED')reject(settled.reasonCode);
  // 到账通知放在结算事务提交之后，并且只有真正完成结算的那一次才发：
  // 支付回调是重试高发区，重复回调在上面已经返回 DUPLICATE，走不到这里；
  // 即便走到，事件键用的是流水 id，同一笔入账也只落一条通知。
  if(settled.outcome==='SETTLED'){
    await notifySafely(() => notifyCoinsReceived({
      userId: settled.userId, transactionId: settled.ledgerId, amount: settled.coins,
      reason: `充值订单 ${settled.orderNo} 金币已到账`,
    }), 'coin_settlement');
  }
  return { duplicate: settled.outcome==='DUPLICATE' };
}
