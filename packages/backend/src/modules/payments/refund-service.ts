import {randomBytes} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {db,pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {requestEzfpRefund,verifyEzfpFullRefund,RefundProviderUncertain} from './ezfp-refund';
import {resolveOrderPaymentConfiguration} from './merchant-config-service';
import {notifyCoinsReceived} from '@rumiai/backend/modules/notifications/write';
import {notifySafely} from '@rumiai/backend/modules/notifications/emit';

export class PaymentRefundError extends Error{
  constructor(message:string,readonly status:number){super(message);this.name='PaymentRefundError';}
}

type RefundState={refundNo:string;status:string;amountCnyCents:number;coinAmount:number;errorCode:string|null;createdAt:Date;completedAt:Date|null;actorId:string;reason:string;approvedById:string|null;approvedAt:Date|null;approvalReason:string|null;rejectedById:string|null;rejectedAt:Date|null;rejectionReason:string|null};
const publicState=(refund:RefundState)=>({refundNo:refund.refundNo,status:refund.status,amountCnyCents:refund.amountCnyCents,coinAmount:refund.coinAmount,errorCode:refund.errorCode,createdAt:refund.createdAt,completedAt:refund.completedAt,reason:refund.reason,approvedAt:refund.approvedAt,approvalReason:refund.approvalReason,rejectedAt:refund.rejectedAt,rejectionReason:refund.rejectionReason});

export async function listRefundablePaymentOrders(orderNo:string|undefined,viewerId:string){
  await pragmasReady;
  const rows=await db.paymentOrder.findMany({
    where:{...(orderNo?{orderNo}:{}),membershipOrder:{is:null},provider:'EZFP',currency:'CNY',status:{in:['PAID','REFUND_PENDING','REFUNDED']}},
    orderBy:[{updatedAt:'desc'},{id:'desc'}],take:orderNo?1:30,
    select:{orderNo:true,provider:true,providerTradeNo:true,currency:true,status:true,amountCnyCents:true,coinAmount:true,paidAt:true,refund:{select:{refundNo:true,status:true,amountCnyCents:true,coinAmount:true,errorCode:true,createdAt:true,completedAt:true,actorId:true,reason:true,approvedById:true,approvedAt:true,approvalReason:true,rejectedById:true,rejectedAt:true,rejectionReason:true}}},
  });
  return rows.map(({refund,...order})=>({...order,refund:refund?{...publicState(refund),requestedByMe:refund.actorId===viewerId}:null}));
}

function refundNo(){return `KRF${Date.now().toString(36).toUpperCase()}${randomBytes(8).toString('hex').toUpperCase()}`;}
function operationReason(input:unknown){if(typeof input!=='string'||!input.trim()||input.trim().length>500)throw new PaymentRefundError('请填写 1–500 字操作理由。',400);return input.trim();}
async function assertRefundEnabled(orderNo:string){
  if(process.env.EZFP_ENABLED!=='true'||process.env.EZFP_REFUNDS_ENABLED!=='true')throw new PaymentRefundError('退款功能尚未启用。',503);
  const order=await db.paymentOrder.findUnique({where:{orderNo},select:{merchantRevisionId:true}});
  if(!order)throw new PaymentRefundError('订单不存在。',404);
  let config;try{config=await resolveOrderPaymentConfiguration(order.merchantRevisionId);}catch{throw new PaymentRefundError('订单关联的商户配置不可用，退款已停止。',503);}
  if(!config.refundsEnabled)throw new PaymentRefundError('该订单所属商户配置未启用退款。',503);
  return config;
}

async function completeRefund(refundId:string,providerRefundNo:string|null){
  return db.$transaction(async tx=>{
    const refund=await tx.paymentRefund.findUnique({where:{id:refundId}});if(!refund)throw new PaymentRefundError('退款记录不存在。',404);
    if(refund.status==='SUCCEEDED')return refund;
    if(!['PROCESSING','UNKNOWN'].includes(refund.status))throw new PaymentRefundError('退款状态已结束，不能重复处理。',409);
    const completed=await tx.paymentRefund.update({where:{id:refund.id},data:{status:'SUCCEEDED',providerRefundNo,errorCode:null,completedAt:new Date()}});
    const changed=await tx.paymentOrder.updateMany({where:{id:refund.paymentOrderId,status:'REFUND_PENDING'},data:{status:'REFUNDED'}});
    if(!changed.count)throw new PaymentRefundError('订单状态与退款记录不一致，请核对账目。',409);
    return completed;
  });
}

async function failAndRelease(refundId:string){
  return db.$transaction(async tx=>{
    const refund=await tx.paymentRefund.findUnique({where:{id:refundId},include:{paymentOrder:true}});if(!refund)throw new PaymentRefundError('退款记录不存在。',404);
    if(refund.status==='FAILED')return {refund,release:null};
    if(refund.status!=='PROCESSING')throw new PaymentRefundError('退款结果仍待核实，金币继续冻结。',409);
    await tx.paymentRefund.update({where:{id:refund.id},data:{status:'FAILED',errorCode:'provider_rejected',completedAt:new Date()}});
    const changed=await tx.paymentOrder.updateMany({where:{id:refund.paymentOrderId,status:'REFUND_PENDING'},data:{status:'PAID'}});
    if(!changed.count)throw new PaymentRefundError('订单状态与退款记录不一致，请核对账目。',409);
    await tx.user.update({where:{id:refund.paymentOrder.userId},data:{coins:{increment:refund.coinAmount}}});
    const ledger=await tx.coinTransaction.create({data:{userId:refund.paymentOrder.userId,refundReleaseId:refund.id,amount:refund.coinAmount,type:'REFUND_RELEASE',sourceKey:'REFUND_RELEASE',description:`退款未成功，返还预留金币 ${refund.paymentOrder.orderNo}`},select:{id:true}});
    return {refund,release:{userId:refund.paymentOrder.userId,ledgerId:ledger.id,coins:refund.coinAmount,orderNo:refund.paymentOrder.orderNo}};
  }).then(async result=>{
    // 到账通知在回冲事务提交之后才写：退回来的金币已经到账，通知失败不影响这笔回冲。
    // release 为 null 说明这次是幂等命中（此前已返还），不重复通知。
    const release=result.release;
    if(release)await notifySafely(()=>notifyCoinsReceived({
      userId:release.userId,transactionId:release.ledgerId,amount:release.coins,
      reason:`退款未成功，${release.coins} 金币已退回`,
    }),'coin_refund_release');
    return result.refund;
  });
}

async function releaseUnapproved(tx:Prisma.TransactionClient,refundId:string,actorId:string,reason:string){
  const refund=await tx.paymentRefund.findUnique({where:{id:refundId},include:{paymentOrder:true}});if(!refund)throw new PaymentRefundError('退款申请不存在。',404);
  if(refund.status!=='PENDING_APPROVAL')throw new PaymentRefundError('该退款申请已被处理。',409);
  if(refund.actorId===actorId)throw new PaymentRefundError('退款申请人不能审批或驳回自己的申请。',403);
  const updated=await tx.paymentRefund.updateMany({where:{id:refund.id,status:'PENDING_APPROVAL'},data:{status:'REJECTED',rejectedById:actorId,rejectedAt:new Date(),rejectionReason:reason,completedAt:new Date()}});
  if(!updated.count)throw new PaymentRefundError('该退款申请已被其他操作处理。',409);
  const order=await tx.paymentOrder.updateMany({where:{id:refund.paymentOrderId,status:'REFUND_PENDING'},data:{status:'PAID'}});
  if(!order.count)throw new PaymentRefundError('订单状态与退款申请不一致，请核对账目。',409);
  await tx.user.update({where:{id:refund.paymentOrder.userId},data:{coins:{increment:refund.coinAmount}}});
  const ledger=await tx.coinTransaction.create({data:{userId:refund.paymentOrder.userId,refundReleaseId:refund.id,amount:refund.coinAmount,type:'REFUND_RELEASE',sourceKey:'REFUND_RELEASE',description:`退款申请被驳回，返还预留金币 ${refund.paymentOrder.orderNo}`},select:{id:true}});
  const saved=await tx.paymentRefund.findUniqueOrThrow({where:{id:refund.id}});
  return {refund:saved,release:{userId:refund.paymentOrder.userId,ledgerId:ledger.id,coins:refund.coinAmount,orderNo:refund.paymentOrder.orderNo}};
}

async function requestReservation(orderNo:string,actorId:string,reason:string){
  return db.$transaction(async tx=>{
    const order=await tx.paymentOrder.findUnique({where:{orderNo},include:{coinTransaction:true,refund:true,membershipOrder:{select:{id:true}}}});if(!order)throw new PaymentRefundError('订单不存在。',404);
    if(order.membershipOrder)throw new PaymentRefundError('会员订单必须按会员权益使用记录计算退款，不能走金币整单退款。',409);
    if(order.refund)return {refund:order.refund,created:false};
    if(order.status!=='PAID'||order.provider!=='EZFP'||order.currency!=='CNY'||!order.providerTradeNo)throw new PaymentRefundError('只有已确认到账的 EZFP 人民币订单可申请退款。',409);
    const original=order.coinTransaction;
    if(!original||original.userId!==order.userId||original.amount!==order.coinAmount||original.type!=='PURCHASE')throw new PaymentRefundError('充值流水异常，已阻止退款，请先核对账目。',409);
    const refund=await tx.paymentRefund.create({data:{paymentOrderId:order.id,refundNo:refundNo(),actorId,reason,amountCnyCents:order.amountCnyCents,coinAmount:order.coinAmount,status:'PENDING_APPROVAL'}});
    const balance=await tx.user.updateMany({where:{id:order.userId,coins:{gte:order.coinAmount}},data:{coins:{decrement:order.coinAmount}}});
    if(!balance.count)throw new PaymentRefundError('账号可用金币不足，未创建退款申请。',409);
    const state=await tx.paymentOrder.updateMany({where:{id:order.id,status:'PAID'},data:{status:'REFUND_PENDING'}});
    if(!state.count)throw new PaymentRefundError('订单状态已变化，请刷新后重试。',409);
    await tx.coinTransaction.create({data:{userId:order.userId,refundId:refund.id,amount:-order.coinAmount,type:'REFUND',sourceKey:'REFUND_RESERVATION',description:`退款申请预留金币 ${order.orderNo}`}});
    return {refund,created:true};
  },{maxWait:10_000,timeout:15_000});
}

export async function requestFullPaymentRefund(orderNo:string,actorId:string,reasonInput:unknown){
  const reason=operationReason(reasonInput);await pragmasReady;await assertRefundEnabled(orderNo);
  const result=await requestReservation(orderNo,actorId,reason);
  if(result.refund.status==='FAILED'||result.refund.status==='REJECTED')throw new PaymentRefundError('该订单已有已结束的退款记录，请复核历史记录后处理。',409);
  return publicState(result.refund);
}

export async function rejectFullPaymentRefund(orderNo:string,actorId:string,reasonInput:unknown){
  const reason=operationReason(reasonInput);await pragmasReady;
  const order=await db.paymentOrder.findUnique({where:{orderNo},include:{refund:true}});
  if(!order?.refund)throw new PaymentRefundError('找不到该订单的退款申请。',404);
  const released=await db.$transaction(tx=>releaseUnapproved(tx,order.refund!.id,actorId,reason),{maxWait:10_000,timeout:15_000});
  // 驳回退款意味着预留金币退回：事务提交后再通知，通知失败不影响驳回本身（V3 §26）。
  await notifySafely(()=>notifyCoinsReceived({
    userId:released.release.userId,transactionId:released.release.ledgerId,amount:released.release.coins,
    reason:`退款申请被驳回，${released.release.coins} 金币已退回`,
  }),'coin_refund_rejected');
  return publicState(released.refund);
}

async function claimForProcessing(refundId:string,actorId:string,allowedStatuses:string[],approvalReason?:string){
  const refund=await db.paymentRefund.findUnique({where:{id:refundId}});if(!refund)throw new PaymentRefundError('退款记录不存在。',404);
  if(refund.status==='PROCESSING'&&Date.now()-refund.attemptedAt.getTime()<60_000)throw new PaymentRefundError('该退款正在处理，请稍后查询退款状态。',409);
  if(!allowedStatuses.includes(refund.status))throw new PaymentRefundError('当前退款状态不能提交到支付渠道。',409);
  const claimed=await db.paymentRefund.updateMany({where:{id:refund.id,status:refund.status,attemptedAt:refund.attemptedAt},data:{status:'PROCESSING',attemptedAt:new Date(),errorCode:null,lastActionById:actorId,...(refund.status==='PENDING_APPROVAL'?{approvedById:actorId,approvedAt:new Date(),approvalReason}:{})}});
  if(!claimed.count)throw new PaymentRefundError('该退款已被另一请求接管，请刷新状态。',409);
  return db.paymentRefund.findUniqueOrThrow({where:{id:refund.id}});
}

async function callProvider(refundId:string,orderNo:string){
  const order=await db.paymentOrder.findUnique({where:{orderNo},include:{refund:true}});if(!order?.refund||order.refund.id!==refundId)throw new PaymentRefundError('退款与订单状态不一致。',409);
  let config;try{config=await resolveOrderPaymentConfiguration(order.merchantRevisionId);}catch{throw new PaymentRefundError('订单关联的商户配置不可用，退款已停止。',503);}
  if(!config.refundsEnabled)throw new PaymentRefundError('该订单所属商户配置未启用退款。',503);
  try{
    const result=await requestEzfpRefund(order.providerTradeNo!,order.refund.refundNo,order.refund.amountCnyCents,config);
    if(!result.success){await failAndRelease(refundId);throw new PaymentRefundError('支付渠道拒绝退款，预留金币已返还。',502);}
    return publicState(await completeRefund(refundId,result.providerRefundNo));
  }catch(error){
    if(error instanceof PaymentRefundError)throw error;
    const code=error instanceof RefundProviderUncertain?error.message:'provider_unexpected_result';
    await db.paymentRefund.updateMany({where:{id:refundId,status:'PROCESSING'},data:{status:'UNKNOWN',errorCode:code,attemptedAt:new Date()}});
    throw new PaymentRefundError('支付渠道结果未能确认，金币暂时冻结。请查询状态后使用同一退款单号重试。',502);
  }
}

export async function approveFullPaymentRefund(orderNo:string,actorId:string,reasonInput:unknown){
  const reason=operationReason(reasonInput);
  await pragmasReady;await assertRefundEnabled(orderNo);
  const order=await db.paymentOrder.findUnique({where:{orderNo},include:{refund:true}});if(!order?.refund)throw new PaymentRefundError('找不到该订单的退款申请。',404);
  if(order.refund.actorId===actorId)throw new PaymentRefundError('退款申请人不能审批自己的申请。',403);
  if(order.refund.status!=='PENDING_APPROVAL')throw new PaymentRefundError('该退款申请已被处理。',409);
  await claimForProcessing(order.refund.id,actorId,['PENDING_APPROVAL'],reason);
  return callProvider(order.refund.id,orderNo);
}

export async function retryFullPaymentRefund(orderNo:string,actorId:string){
  await pragmasReady;await assertRefundEnabled(orderNo);
  const order=await db.paymentOrder.findUnique({where:{orderNo},include:{refund:true}});if(!order?.refund)throw new PaymentRefundError('找不到该订单的退款记录。',404);
  if(order.refund.status==='SUCCEEDED')return publicState(order.refund);
  if(order.refund.status==='FAILED'||order.refund.status==='REJECTED')throw new PaymentRefundError('该退款记录已结束，不能重试。',409);
  if(!order.refund.approvedById)throw new PaymentRefundError('退款尚未获批，不能提交到支付渠道。',409);
  await claimForProcessing(order.refund.id,actorId,['UNKNOWN','PROCESSING']);
  return callProvider(order.refund.id,orderNo);
}

export async function verifyPaymentRefund(orderNo:string){
  const order=await db.paymentOrder.findUnique({where:{orderNo},include:{refund:true}});if(!order?.refund)throw new PaymentRefundError('找不到该订单的退款记录。',404);
  if(order.refund.status==='PENDING_APPROVAL')throw new PaymentRefundError('退款仍待审批，尚未联系支付渠道。',409);
  if(!order.refund.approvedById)throw new PaymentRefundError('退款审批记录缺失，已阻止渠道查询。',409);
  if(order.refund.status==='SUCCEEDED'||['FAILED','REJECTED'].includes(order.refund.status))return publicState(order.refund);
  let config;try{config=await resolveOrderPaymentConfiguration(order.merchantRevisionId);}catch{throw new PaymentRefundError('订单关联的商户配置不可用，无法核实退款。',503);}
  try{
    const refunded=await verifyEzfpFullRefund(order.providerTradeNo!,order.orderNo,order.amountCnyCents,config);
    if(refunded)return publicState(await completeRefund(order.refund.id,order.refund.providerRefundNo));
    await db.paymentRefund.updateMany({where:{id:order.refund.id,status:{in:['PROCESSING','UNKNOWN']}},data:{status:'UNKNOWN',errorCode:'provider_still_paid'}});
    return {...publicState({...order.refund,status:'UNKNOWN',errorCode:'provider_still_paid'}),errorCode:'provider_still_paid'};
  }catch(error){if(error instanceof RefundProviderUncertain)return {...publicState(order.refund),errorCode:error.message};throw error;}
}
