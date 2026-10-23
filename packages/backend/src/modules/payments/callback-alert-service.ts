import {randomUUID} from 'node:crypto';
import {db,pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {hasAdminPermission} from '@rumiai/backend/modules/admin/authorization';
import {checkRateLimit} from '@rumiai/backend/infrastructure/http/rate-limit';

const REASON_LABELS:Record<string,string>={
  duplicate_fields:'通知参数重复',
  required_fields_or_status:'缺少必需字段或支付状态不符',
  order_not_found:'订单不存在或渠道/币种不匹配',
  provider_config_missing:'订单商户配置不可用',
  signature_or_timestamp:'签名或时间戳校验失败',
  amount_mismatch:'订单金额不匹配',
  provider_order_mismatch:'渠道交易号不匹配',
  paid_order_trade_mismatch:'已支付订单交易号冲突',
  order_not_pending:'订单状态不允许入账',
  other:'其他校验失败',
};
const PROVIDER='EZFP';

/** Store one database-enforced sample per known reason and UTC minute. */
export async function recordCallbackRejectionSample(reasonInput:string,now=new Date()){
  const reason=Object.hasOwn(REASON_LABELS,reasonInput)?reasonInput:'other';
  const minuteKey=now.toISOString().slice(0,16);
  if(!checkRateLimit(`payment-callback-alert:${reason}:${minuteKey}`,1,60_000).allowed)return false;
  await pragmasReady;
  const minuteStart=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate(),now.getUTCHours(),now.getUTCMinutes()));
  const dayKey=now.toISOString().slice(0,10);
  if(checkRateLimit(`payment-callback-alert-prune:${dayKey}`,1,24*60*60_000).allowed){
    const cutoff=new Date(now.getTime()-30*24*60*60_000);
    await db.paymentCallbackAlertSample.deleteMany({where:{minuteStart:{lt:cutoff}}});
  }
  await db.paymentCallbackAlertSample.upsert({
    where:{provider_minuteStart_reasonCode:{provider:PROVIDER,minuteStart,reasonCode:reason}},
    create:{id:randomUUID().replaceAll('-',''),provider:PROVIDER,minuteStart,reasonCode:reason,firstSeenAt:now,lastSeenAt:now},
    update:{lastSeenAt:now},
  });
  return true;
}

export class CallbackAlertError extends Error{
  constructor(message:string,readonly status:number){super(message);this.name='CallbackAlertError';}
}

export async function readCallbackAlertSummary(actorId:string,hoursInput:unknown){
  const hours=hoursInput===undefined?24:Number(hoursInput);
  if(!Number.isInteger(hours)||![24,168].includes(hours))throw new CallbackAlertError('统计范围只支持24或168小时。',400);
  await pragmasReady;
  if(!await hasAdminPermission(actorId,'finance.read'))throw new CallbackAlertError('当前账号没有财务查看权限。',403);
  const generatedAt=new Date(),requestedSince=new Date(generatedAt.getTime()-hours*60*60_000),since=new Date(Date.UTC(requestedSince.getUTCFullYear(),requestedSince.getUTCMonth(),requestedSince.getUTCDate(),requestedSince.getUTCHours(),requestedSince.getUTCMinutes()));
  const rows=await db.paymentCallbackAlertSample.findMany({where:{provider:PROVIDER,minuteStart:{gte:since}},orderBy:[{minuteStart:'desc'},{reasonCode:'asc'}],take:hours*60*Object.keys(REASON_LABELS).length});
  const summary=new Map<string,{reasonCode:string;label:string;sampledMinutes:number;firstSeenAt:Date;lastSeenAt:Date}>();
  for(const row of rows){
    const current=summary.get(row.reasonCode);
    if(current){current.sampledMinutes+=1;if(row.firstSeenAt<current.firstSeenAt)current.firstSeenAt=row.firstSeenAt;if(row.lastSeenAt>current.lastSeenAt)current.lastSeenAt=row.lastSeenAt;}
    else summary.set(row.reasonCode,{reasonCode:row.reasonCode,label:REASON_LABELS[row.reasonCode]??REASON_LABELS.other,sampledMinutes:1,firstSeenAt:row.firstSeenAt,lastSeenAt:row.lastSeenAt});
  }
  const reasons=[...summary.values()].sort((a,b)=>b.sampledMinutes-a.sampledMinutes||a.reasonCode.localeCompare(b.reasonCode));
  return {provider:PROVIDER,hours,generatedAt:generatedAt.toISOString(),since:since.toISOString(),retentionDays:30,sampling:'数据库唯一约束保证每种原因每 UTC 分钟最多记录一次；采样分钟不代表通知总量。',sampledMinutes:reasons.reduce((sum,row)=>sum+row.sampledMinutes,0),reasons:reasons.map(row=>({...row,firstSeenAt:row.firstSeenAt.toISOString(),lastSeenAt:row.lastSeenAt.toISOString()}))};
}
