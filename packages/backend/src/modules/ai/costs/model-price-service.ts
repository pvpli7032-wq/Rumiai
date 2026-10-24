import type {Prisma} from '@prisma/client';
import {db,pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {hasAdminPermission} from '@rumiai/backend/modules/admin/authorization';
import {recordAdminAudit} from '@rumiai/backend/modules/admin/management-service';
import {readAiPriceConfiguration} from '@rumiai/backend/modules/ai/cost-accounting';

type Reader=Pick<Prisma.TransactionClient,'aiModel'|'aiModelPrice'>;
type TierRow={id:string;priceId:string;minInputTokens:number;maxInputTokens:number|null;inputPerMillionMicros:bigint;outputPerMillionMicros:bigint;cachedInputPerMillionMicros:bigint|null;sortOrder:number};
type PriceRow=Awaited<ReturnType<Reader['aiModelPrice']['findMany']>>[number]&{tiers:TierRow[]};

export class AiModelPriceError extends Error{
  constructor(message:string,public status=400){super(message);this.name='AiModelPriceError';}
}

async function requirePermission(actor:string,permission:'ai.costs.read'|'ai.costs.manage',tx?:Parameters<typeof hasAdminPermission>[2]){
  if(!await hasAdminPermission(actor,permission,tx))throw new AiModelPriceError('当前账号没有 AI 模型价格管理权限。',403);
}
function object(value:unknown){if(!value||typeof value!=='object'||Array.isArray(value))throw new AiModelPriceError('模型价格格式无效。');return value as Record<string,unknown>;}
function text(value:unknown,label:string,max:number){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new AiModelPriceError(`${label}格式无效。`);return value.trim();}
function moneyMicros(value:unknown,label:string){
  if(typeof value!=='string'||!/^\d{1,12}(?:\.\d{1,6})?$/.test(value.trim()))throw new AiModelPriceError(`${label}须为非负且最多6位小数的金额。`);
  const [whole,fraction='']=value.trim().split('.');return BigInt(whole)*BigInt(1_000_000)+BigInt(fraction.padEnd(6,'0'));
}
function formatMicros(value:bigint){const scale=BigInt(1_000_000),whole=value/scale,fraction=(value%scale).toString().padStart(6,'0').replace(/0+$/,'');return fraction?`${whole}.${fraction}`:String(whole);}
function date(value:unknown){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))throw new AiModelPriceError('生效时间必须为 UTC ISO 时间。');
  const parsed=new Date(value),canonical=value.replace(/(?:\.(\d{1,3}))?Z$/,(_match,fraction='')=>`.${fraction.padEnd(3,'0')}Z`);if(!Number.isFinite(parsed.getTime())||parsed.toISOString()!==canonical)throw new AiModelPriceError('生效时间无效。');return parsed;
}
function parseTiers(value:unknown){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>20)throw new AiModelPriceError('成本阶梯最多包含 20 个区间。');
  if(value.length===0)return [];
  const tiers=value.map((raw,index)=>{
    const row=object(raw);
    const allowed=new Set(['minInputTokens','maxInputTokens','inputPricePerMillion','outputPricePerMillion','cachedInputPricePerMillion']);
    if(Object.keys(row).some(key=>!allowed.has(key)))throw new AiModelPriceError(`第 ${index+1} 个成本阶梯包含未知字段。`);
    if(!Number.isSafeInteger(row.minInputTokens)||Number(row.minInputTokens)<0)throw new AiModelPriceError(`第 ${index+1} 个阶梯起始 Token 无效。`);
    const max=row.maxInputTokens===null?null:Number(row.maxInputTokens);
    if(max!==null&&(!Number.isSafeInteger(max)||max<=Number(row.minInputTokens)))throw new AiModelPriceError(`第 ${index+1} 个阶梯结束 Token 无效。`);
    return {minInputTokens:Number(row.minInputTokens),maxInputTokens:max,inputPerMillionMicros:moneyMicros(row.inputPricePerMillion,`第 ${index+1} 个阶梯输入单价`),outputPerMillionMicros:moneyMicros(row.outputPricePerMillion,`第 ${index+1} 个阶梯输出单价`),cachedInputPerMillionMicros:row.cachedInputPricePerMillion===null||row.cachedInputPricePerMillion===undefined?null:moneyMicros(row.cachedInputPricePerMillion,`第 ${index+1} 个阶梯缓存输入单价`),sortOrder:index};
  }).sort((a,b)=>a.minInputTokens-b.minInputTokens).map((tier,index)=>({...tier,sortOrder:index}));
  if(tiers[0].minInputTokens!==0)throw new AiModelPriceError('成本阶梯必须从 0 Token 开始。');
  for(let index=0;index<tiers.length;index++){
    const tier=tiers[index],next=tiers[index+1];
    if(next&&tier.maxInputTokens!==next.minInputTokens)throw new AiModelPriceError('成本阶梯必须连续且不能重叠。');
    if(!next&&tier.maxInputTokens!==null)throw new AiModelPriceError('最后一个成本阶梯必须无上限。');
    if(!next&&tier.maxInputTokens===null)continue;
    if(tier.maxInputTokens===null)throw new AiModelPriceError('只有最后一个成本阶梯可以无上限。');
  }
  return tiers;
}
function tierView(row:TierRow){return {id:row.id,minInputTokens:row.minInputTokens,maxInputTokens:row.maxInputTokens,inputPricePerMillion:formatMicros(row.inputPerMillionMicros),outputPricePerMillion:formatMicros(row.outputPerMillionMicros),cachedInputPricePerMillion:row.cachedInputPerMillionMicros===null?null:formatMicros(row.cachedInputPerMillionMicros)};}
function priceView(row:PriceRow){const {inputPerMillionMicros,outputPerMillionMicros,createdBy,tiers,...safe}=row;return {...safe,inputPricePerMillion:formatMicros(inputPerMillionMicros),outputPricePerMillion:formatMicros(outputPerMillionMicros),tiers:tiers.map(tierView)};}

export async function readCurrentAiModelPrices(reader:Reader,modelKeys:string[],asOf=new Date()){
  if(!modelKeys.length)return [];
  const models=await reader.aiModel.findMany({where:{key:{in:[...new Set(modelKeys)]}},select:{id:true,key:true,displayName:true,modelCode:true,provider:{select:{name:true}}}});
  if(!models.length)return [];
  const rows=await reader.aiModelPrice.findMany({where:{modelId:{in:models.map(model=>model.id)},effectiveAt:{lte:asOf}},include:{tiers:{orderBy:{sortOrder:'asc'}}},orderBy:{effectiveAt:'desc'}});
  const current=new Map<string,PriceRow>();for(const row of rows)if(!current.has(row.modelId))current.set(row.modelId,row);
  return models.flatMap(model=>{const price=current.get(model.id);return price?[{model,price}]:[];});
}

/** Report coverage for all active managed models or the exact candidate chain for one chat. */
export async function readAiModelPriceCoverage(reader:Reader,asOf=new Date(),modelKeys?:string[]){
  const keys=modelKeys??(await reader.aiModel.findMany({where:{isActive:true,provider:{isActive:true}},select:{key:true}})).map(row=>row.key);
  if(!keys.length)return {configured:Boolean(readAiPriceConfiguration()),complete:Boolean(readAiPriceConfiguration()),currencies:[] as string[],unpricedModels:[] as string[]};
  const prices=await readCurrentAiModelPrices(reader,keys,asOf),priced=new Set(prices.map(item=>item.model.key));
  return {configured:prices.length>0,complete:priced.size===new Set(keys).size,currencies:[...new Set(prices.map(item=>item.price.currency))].sort(),unpricedModels:[...new Set(keys)].filter(key=>!priced.has(key)).sort()};
}

export async function readAiModelPriceSettings(actor:string){
  await requirePermission(actor,'ai.costs.read');await pragmasReady;
  return db.$transaction(async tx=>{
    await requirePermission(actor,'ai.costs.read',tx);
    const models=await tx.aiModel.findMany({include:{provider:{select:{name:true}}},orderBy:[{sortOrder:'asc'},{key:'asc'}],take:200});
    const rows=models.length?await tx.aiModelPrice.findMany({where:{modelId:{in:models.map(model=>model.id)}},include:{tiers:{orderBy:{sortOrder:'asc'}}},orderBy:{effectiveAt:'desc'},take:2000}):[];
    const grouped=new Map<string,PriceRow[]>();for(const row of rows){const versions=grouped.get(row.modelId)??[];if(versions.length<20)versions.push(row);grouped.set(row.modelId,versions);}
    const now=new Date();
    return {generatedAt:now.toISOString(),models:models.map(model=>({id:model.id,key:model.key,displayName:model.displayName,modelCode:model.modelCode,providerName:model.provider.name,isActive:model.isActive,prices:(grouped.get(model.id)??[]).map(priceView)}))};
  });
}

export async function saveAiModelPrice(actor:string,input:unknown){
  await requirePermission(actor,'ai.costs.manage');
  const row=object(input),allowed=new Set(['modelId','currency','inputPricePerMillion','outputPricePerMillion','effectiveAt','source','reason','tiers']);
  if(Object.keys(row).some(key=>!allowed.has(key)))throw new AiModelPriceError('模型价格字段与当前表单不匹配。');
  const modelId=text(row.modelId,'模型',100),currency=text(row.currency,'币种',3);
  if(!/^[A-Z]{3}$/.test(currency))throw new AiModelPriceError('币种必须为三个大写字母。');
  const inputPerMillionMicros=moneyMicros(row.inputPricePerMillion,'输入单价'),outputPerMillionMicros=moneyMicros(row.outputPricePerMillion,'输出单价');
  const tiers=parseTiers(row.tiers);
  const effectiveAt=date(row.effectiveAt),source=text(row.source,'价格来源',500),reason=text(row.reason,'操作理由',300);
  await pragmasReady;
  try{return await db.$transaction(async tx=>{
    await tx.$executeRaw`UPDATE admin_operators SET version=version WHERE user_id=${actor}`;
    await requirePermission(actor,'ai.costs.manage',tx);
    const model=await tx.aiModel.findUnique({where:{id:modelId},select:{id:true,key:true,displayName:true}});if(!model)throw new AiModelPriceError('模型不存在。',404);
    const latest=await tx.aiModelPrice.findFirst({where:{modelId},orderBy:{effectiveAt:'desc'},select:{effectiveAt:true}});
    if(latest&&effectiveAt<=latest.effectiveAt)throw new AiModelPriceError('新价格的生效时间必须晚于该模型已有版本；价格历史不可改写。',409);
    const saved=await tx.aiModelPrice.create({data:{modelId,currency,inputPerMillionMicros,outputPerMillionMicros,effectiveAt,source,reason,createdBy:actor,...(tiers.length?{tiers:{create:tiers}}:{})},include:{tiers:{orderBy:{sortOrder:'asc'}}}});
    await recordAdminAudit(tx,actor,'CREATE_AI_MODEL_PRICE',saved.id,reason,{modelKey:model.key,currency,inputPricePerMillion:formatMicros(inputPerMillionMicros),outputPricePerMillion:formatMicros(outputPerMillionMicros),effectiveAt:effectiveAt.toISOString(),source,tiers:saved.tiers.map(tierView)});
    return {id:saved.id,modelId,modelKey:model.key,currency,inputPricePerMillion:formatMicros(inputPerMillionMicros),outputPricePerMillion:formatMicros(outputPerMillionMicros),tiers:saved.tiers.map(tierView),effectiveAt:saved.effectiveAt,source,createdAt:saved.createdAt};
  });}catch(error){if(error instanceof AiModelPriceError)throw error;if((error as {code?:string})?.code==='P2002')throw new AiModelPriceError('该生效时间已存在价格版本，请刷新后重试。',409);throw error;}
}

export function estimateAiCostFromPrice(inputTokens:number|undefined,outputTokens:number|undefined,inputPerMillionMicros:bigint,outputPerMillionMicros:bigint){
  if(inputTokens===undefined||outputTokens===undefined||!Number.isSafeInteger(inputTokens)||!Number.isSafeInteger(outputTokens)||inputTokens<0||outputTokens<0)return null;
  const micros=inputPerMillionMicros*BigInt(inputTokens)+outputPerMillionMicros*BigInt(outputTokens);
  const amount=Number(micros)/Number(BigInt(1_000_000_000_000));
  return Number.isFinite(amount)?amount:null;
}

export interface AiCostTierInput extends Omit<TierRow,'priceId'|'sortOrder'>{}
export function estimateAiCostFromTieredPrice(inputTokens:number|undefined,outputTokens:number|undefined,cachedInputTokens:number|undefined,price:{id:string;inputPerMillionMicros:bigint;outputPerMillionMicros:bigint;tiers?:AiCostTierInput[]}){
  if(inputTokens===undefined||outputTokens===undefined||!Number.isSafeInteger(inputTokens)||!Number.isSafeInteger(outputTokens)||inputTokens<0||outputTokens<0)return null;
  const cached=cachedInputTokens??0;
  if(!Number.isSafeInteger(cached)||cached<0||cached>inputTokens)return null;
  const tier=(price.tiers??[]).find(item=>inputTokens>=item.minInputTokens&&(item.maxInputTokens===null||inputTokens<item.maxInputTokens));
  const inputRate=tier?.inputPerMillionMicros??price.inputPerMillionMicros,outputRate=tier?.outputPerMillionMicros??price.outputPerMillionMicros,cachedRate=tier?.cachedInputPerMillionMicros??inputRate;
  const uncached=inputTokens-cached;
  const numerator=inputRate*BigInt(uncached)+cachedRate*BigInt(cached)+outputRate*BigInt(outputTokens);
  const amount=Number(numerator)/Number(BigInt(1_000_000_000_000));
  if(!Number.isFinite(amount))return null;
  return {amount,tierId:tier?.id??null,audit:{version:1,priceId:price.id,tierId:tier?.id??null,minInputTokens:tier?.minInputTokens??null,maxInputTokens:tier?.maxInputTokens??null,inputTokens,outputTokens,cachedInputTokens:cached,inputPricePerMillion:formatMicros(inputRate),outputPricePerMillion:formatMicros(outputRate),cachedInputPricePerMillion:formatMicros(cachedRate)}};
}
