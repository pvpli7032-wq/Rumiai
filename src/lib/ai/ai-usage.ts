import { db, pragmasReady } from '@/lib/db';
import { CHAT_DAILY_LIMIT } from '@/lib/ai/config';
import type { AiStreamMetrics } from '@/lib/ai/types';

export const quotaDay = (now = new Date()) => now.toISOString().slice(0,10);
export const quotaReset = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1));
export class AiQuotaError extends Error {
  constructor(public retryAfter:number){super('今日 AI 调用额度已用完，请在重置后继续。');this.name='AiQuotaError';}
}
const currency = () => process.env.AI_PRICE_CURRENCY?.trim() || 'USD';
function price(value:string|undefined):number|null{
  if(value===undefined||!value.trim())return null;
  const number=Number(value);return Number.isFinite(number)&&number>=0?number:null;
}
/** One accepted user action spends one slot, even if its upstream later fails.
 * The conditional write and call record share a transaction, so concurrent requests
 * and process restarts cannot mint extra daily slots.
 */
export async function reserveAiCall(userId:string,conversationId:string,operation:'SEND'|'REGENERATE'){
  await pragmasReady;
  const now=new Date(),day=quotaDay(now);
  if(CHAT_DAILY_LIMIT===0)throw new AiQuotaError(Math.ceil((quotaReset(now).getTime()-now.getTime())/1000));
  return db.$transaction(async tx=>{
    const changed=await tx.$executeRaw`INSERT INTO ai_daily_usage (user_id,day,count) VALUES (${userId},${day},1)
      ON CONFLICT(user_id,day) DO UPDATE SET count=count+1 WHERE count < ${CHAT_DAILY_LIMIT}`;
    if(!changed)throw new AiQuotaError(Math.ceil((quotaReset(now).getTime()-now.getTime())/1000));
    return tx.aiCall.create({data:{userId,conversationId,operation,currency:currency()}});
  });
}
export async function finishAiCall(id:string,startedAt:Date,status:'SUCCEEDED'|'FAILED'|'CANCELLED'|'MOCK',metrics:AiStreamMetrics={},errorCode?:string){
  const input=metrics.inputTokens??null,output=metrics.outputTokens??null;
  const inputPrice=price(process.env.AI_INPUT_PRICE_PER_MILLION),outputPrice=price(process.env.AI_OUTPUT_PRICE_PER_MILLION);
  const pricedModel=process.env.AI_PRICE_MODEL||process.env.AI_MODEL||'gpt-4o-mini';
  const estimatedCost=status==='MOCK'?0:metrics.model===pricedModel&&input!==null&&output!==null&&inputPrice!==null&&outputPrice!==null?(input*inputPrice+output*outputPrice)/1_000_000:null;
  return db.aiCall.update({where:{id},data:{status,model:metrics.model??null,attempts:metrics.attempts??0,inputTokens:input,outputTokens:output,estimatedCost,errorCode:errorCode??null,finishedAt:new Date(),durationMs:Date.now()-startedAt.getTime()}});
}
export async function readAiUsage(userId:string){
  const now=new Date();const [daily,calls]=await Promise.all([
    db.aiDailyUsage.findUnique({where:{userId_day:{userId,day:quotaDay(now)}}}),
    db.aiCall.findMany({where:{userId},orderBy:{startedAt:'desc'},take:20,select:{id:true,operation:true,status:true,model:true,attempts:true,inputTokens:true,outputTokens:true,estimatedCost:true,currency:true,errorCode:true,startedAt:true,durationMs:true}}),
  ]);
  const used=daily?.count??0;
  return {day:quotaDay(now),timezone:'UTC',limit:CHAT_DAILY_LIMIT,used,remaining:Math.max(0,CHAT_DAILY_LIMIT-used),resetAt:quotaReset(now).toISOString(),calls};
}
