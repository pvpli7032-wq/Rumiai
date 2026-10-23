import { db, pragmasReady } from '@rumiai/backend/infrastructure/database/client';
import {readDailyRequestRules} from '@rumiai/backend/modules/settings/limits';
import {isValidTimezone, resolveZonedDay, resolveZonedDayBoundary} from '@rumiai/backend/infrastructure/time/zoned-day';
import type { AiStreamMetrics } from '@rumiai/backend/modules/ai/types';
import { readCostBudgetBlock, type AiBudgetBlock } from './budget-guard';
import { estimateAiCallCost } from './cost-accounting';
import { logWarning } from '@rumiai/backend/infrastructure/logging/logger';
import { readAiDailyBudgetConfiguration } from './costs/budget-config-service';
import {readCurrentAiModelPrices,estimateAiCostFromPrice} from './costs/model-price-service';
import {ledgerTaskType, readTaskBudget, readTaskUsageOf, taskBudgetBlock, type AiTaskType} from './task-budget';

/** 每日调用额度的业务日；时区来自 billing.dayTimezone，默认 UTC（V3 表 8）。 */
export const quotaDay = (now = new Date(), timezone = 'UTC') => resolveZonedDay(now, timezone);
export const quotaReset = (now = new Date(), timezone = 'UTC') => resolveZonedDayBoundary(now, timezone).resetAt;
export class AiQuotaError extends Error {
  public status: 429 | 503;
  constructor(public retryAfter:number, public block?:AiBudgetBlock){super(block?.message ?? '今日 AI 调用额度已用完，请在重置后继续。');this.name='AiQuotaError';this.status=block?.status ?? 429;}
}
const currency = () => process.env.AI_PRICE_CURRENCY?.trim() || 'USD';
const logBudgetBlock = (event:string,block:AiBudgetBlock,callId?:string) => logWarning(event,{code:block.code,scope:block.scope,currency:block.currency,...(callId?{callId}:{})});
/** One accepted user action spends one slot, even if its upstream later fails.
 * The conditional write and call record share a transaction, so concurrent requests
 * and process restarts cannot mint extra daily slots.
 *
 * STATE_EXTRACT / DISPUTE_VERDICT / MEMORY_SUMMARY / PROMPT_PREVIEW are background tasks: they are
 * checked against the cost budget and recorded in the call ledger, but do NOT consume
 * the user's chat daily slots — 独立用量口径. Budget exhaustion defers the background
 * task instead of failing the user's already-committed replies.
 */
export type AiOperation = 'SEND' | 'REGENERATE' | 'STATE_EXTRACT' | 'DISPUTE_VERDICT' | 'MEMORY_SUMMARY' | 'PROMPT_PREVIEW';
/** 只有用户主动的聊天回合消耗聊天每日次数；后台任务只受成本预算约束。 */
const CONSUMES_DAILY_SLOT = new Set<AiOperation>(['SEND', 'REGENERATE']);
/**
 * task 是业务任务类型（V3 表 9）：写进台账 task_type，并按任务预算单独设闸。
 * 任务预算触发只暂停该任务，不触发全站熔断；它的消耗仍计入全站预算。
 */
export async function reserveAiCall(userId:string,conversationId:string,operation:AiOperation,modelKeys?:string[],task?:AiTaskType){
  await pragmasReady;
  const now=new Date();
  // 上限与时区来自设置中心；0 表示暂停新请求，不是无限。
  const rules=await readDailyRequestRules();
  const timezone=isValidTimezone(rules.timezone)?rules.timezone:'UTC';
  const limit=rules.hardDailyMessages;
  const consumesSlot=CONSUMES_DAILY_SLOT.has(operation);
  if(consumesSlot&&limit===0)throw new AiQuotaError(Math.ceil((quotaReset(now,timezone).getTime()-now.getTime())/1000));
  // 任务预算在事务外读设置：设置缓存可能另开连接，别和写事务抢同一条 SQLite 连接。
  const taskLimit=task?await readTaskBudget(task):null;
  try { return await db.$transaction(async tx=>{
    // Claim the quota writer before choosing the UTC day or inspecting completed costs.
    // A request queued behind another completion must evaluate that completion, too.
    await tx.$executeRaw`UPDATE ai_daily_usage SET count=count WHERE user_id=${userId}`;
    const now=new Date(),day=quotaDay(now,timezone);
    if(consumesSlot){
      const changed=await tx.$executeRaw`INSERT INTO ai_daily_usage (user_id,day,count) VALUES (${userId},${day},1)
        ON CONFLICT(user_id,day) DO UPDATE SET count=count+1 WHERE count < ${limit}`;
      if(!changed)throw new AiQuotaError(Math.ceil((quotaReset(now,timezone).getTime()-now.getTime())/1000));
    }
    const callCurrency=currency();
    const block=await readCostBudgetBlock(tx,userId,now,callCurrency,modelKeys);
    if(block)throw new AiQuotaError(block.status===429?Math.ceil((quotaReset(now,timezone).getTime()-now.getTime())/1000):0,block);
    if(task&&taskLimit!==null){
      const taskBlock=taskBudgetBlock(task,taskLimit,await readTaskUsageOf(tx,now,task));
      if(taskBlock)throw new AiQuotaError(Math.ceil((quotaReset(now,timezone).getTime()-now.getTime())/1000),taskBlock);
    }
    return tx.aiCall.create({data:{userId,conversationId,operation,currency:callCurrency,startedAt:now,...(task?{taskType:ledgerTaskType(task)}:{})}});
  }); } catch(error) {
    if(error instanceof AiQuotaError && error.block)logBudgetBlock('ai_budget_blocked',error.block);
    throw error;
  }
}
export async function finishAiCall(id:string,startedAt:Date,status:'SUCCEEDED'|'FAILED'|'CANCELLED'|'MOCK',metrics:AiStreamMetrics={},errorCode?:string){
  const input=metrics.inputTokens??null,output=metrics.outputTokens??null;
  let price:{id:string;currency:string;inputPerMillionMicros:bigint;outputPerMillionMicros:bigint}|undefined,priceLookupFailed=false;
  if(status!=='MOCK'&&metrics.modelKey){try{price=(await readCurrentAiModelPrices(db,[metrics.modelKey],startedAt))[0]?.price;}catch{priceLookupFailed=true;logWarning('ai_model_price_lookup_failed',{callId:id});}}
  const estimatedCost=status==='MOCK'?0:price?estimateAiCostFromPrice(input??undefined,output??undefined,price.inputPerMillionMicros,price.outputPerMillionMicros):priceLookupFailed?null:estimateAiCallCost(status,metrics);
  const call=await db.aiCall.update({where:{id},data:{status,model:metrics.model??null,attempts:metrics.attempts??0,inputTokens:input,outputTokens:output,estimatedCost,...(price?{currency:price.currency,modelPriceId:price.id}:{}),errorCode:errorCode??null,finishedAt:new Date(),durationMs:Date.now()-startedAt.getTime()}});
  let circuitBreaker:string;
  try { circuitBreaker=(await readAiDailyBudgetConfiguration()).circuitBreaker; }
  catch { logWarning('ai_budget_monitor_failed',{callId:id}); return call; }
  if(circuitBreaker!=='enabled')return call;
  // A monitoring failure must not roll back an already completed cost record.
  // Anonymous calls have no per-user budget; their cost still counts toward the site total.
  if (call.userId) try {
    const block=await db.$transaction(tx=>readCostBudgetBlock(tx,call.userId!,new Date(),call.currency));
    if(block)logBudgetBlock('ai_budget_alert',block,id);
  } catch { logWarning('ai_budget_monitor_failed',{callId:id}); }
  return call;
}
export async function readAiUsage(userId:string){
  const now=new Date();const rules=await readDailyRequestRules();
  const timezone=isValidTimezone(rules.timezone)?rules.timezone:'UTC',limit=rules.hardDailyMessages;
  const [daily,calls]=await Promise.all([
    db.aiDailyUsage.findUnique({where:{userId_day:{userId,day:quotaDay(now,timezone)}}}),
    db.aiCall.findMany({where:{userId},orderBy:{startedAt:'desc'},take:20,select:{id:true,operation:true,status:true,model:true,attempts:true,inputTokens:true,outputTokens:true,estimatedCost:true,currency:true,errorCode:true,startedAt:true,durationMs:true}}),
  ]);
  const used=daily?.count??0;
  return {day:quotaDay(now,timezone),timezone,limit,used,remaining:Math.max(0,limit-used),resetAt:quotaReset(now,timezone).toISOString(),calls};
}
