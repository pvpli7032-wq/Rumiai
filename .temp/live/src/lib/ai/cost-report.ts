import type { Prisma } from '@prisma/client';
import { classifyAiCostGroup } from './cost-accounting';

/** Keep currencies separate and unknown upstream costs explicit. */
export async function readAiCostReport(tx: Prisma.TransactionClient, since: Date, until = new Date()) {
  const groups = await tx.aiCall.groupBy({
    by: ['currency', 'status', 'attempts'], where: { startedAt: { gte: since, lte: until } },
    _count: { _all: true, estimatedCost: true }, _sum: { estimatedCost: true },
  });
  const currencies = new Map<string, { currency: string; calls: number; knownCostCalls: number; unknownCostCalls: number; estimatedCost: number; failedCalls: number; mockCalls: number }>();
  for (const group of groups) {
    const row = currencies.get(group.currency) ?? { currency: group.currency, calls: 0, knownCostCalls: 0, unknownCostCalls: 0, estimatedCost: 0, failedCalls: 0, mockCalls: 0 };
    row.calls += group._count._all;
    if (group.status === 'MOCK') row.mockCalls += group._count._all;
    else {
      const cost = classifyAiCostGroup(group);
      row.knownCostCalls += cost.knownCostCalls;
      row.unknownCostCalls += cost.unknownCostCalls;
      row.estimatedCost += cost.knownCost;
    }
    if (['FAILED', 'CANCELLED'].includes(group.status)) row.failedCalls += group._count._all;
    currencies.set(group.currency, row);
  }
  return [...currencies.values()].sort((a, b) => a.currency.localeCompare(b.currency)).map(row => {
    const realCalls = row.calls - row.mockCalls;
    return { ...row, realCalls, costPerThousandCalls: realCalls > 0 && row.unknownCostCalls === 0 ? row.estimatedCost / realCalls * 1000 : null };
  });
}

/** Aggregate by the immutable model-price snapshot, never by user or conversation content. */
export async function readAiModelCostReport(tx:Prisma.TransactionClient,since:Date,until=new Date()){
  const groups=await tx.aiCall.groupBy({
    by:['modelPriceId','model','currency','status','attempts'],
    where:{startedAt:{gte:since,lte:until},status:{not:'MOCK'}},
    _count:{_all:true,estimatedCost:true},_sum:{estimatedCost:true},
  });
  const priceIds=[...new Set(groups.flatMap(group=>group.modelPriceId?[group.modelPriceId]:[]))];
  const prices=priceIds.length?await tx.aiModelPrice.findMany({where:{id:{in:priceIds}},include:{model:{select:{id:true,key:true,displayName:true,provider:{select:{name:true}}}}}}):[];
  const byPrice=new Map(prices.map(price=>[price.id,price]));
  const totals=new Map<string,{modelId:string|null;modelKey:string|null;displayName:string;providerName:string|null;providerModelCode:string|null;currency:string;calls:number;knownCostCalls:number;unknownCostCalls:number;estimatedCost:number;failedCalls:number}>();
  for(const group of groups){
    const price=group.modelPriceId?byPrice.get(group.modelPriceId):undefined;
    const key=price?`model:${price.modelId}:${group.currency}`:`unpriced:${group.model??'unknown'}:${group.currency}`;
    const row=totals.get(key)??{modelId:price?.modelId??null,modelKey:price?.model.key??null,displayName:price?.model.displayName??group.model??'模型未知',providerName:price?.model.provider.name??null,providerModelCode:price?null:group.model,currency:group.currency,calls:0,knownCostCalls:0,unknownCostCalls:0,estimatedCost:0,failedCalls:0};
    const cost=classifyAiCostGroup(group);
    row.calls+=group._count._all;row.knownCostCalls+=cost.knownCostCalls;row.unknownCostCalls+=cost.unknownCostCalls;row.estimatedCost+=cost.knownCost;
    if(['FAILED','CANCELLED'].includes(group.status))row.failedCalls+=group._count._all;
    totals.set(key,row);
  }
  return [...totals.values()].sort((a,b)=>a.displayName.localeCompare(b.displayName)||a.currency.localeCompare(b.currency));
}
