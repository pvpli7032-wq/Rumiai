import {randomUUID} from 'node:crypto';
import {db,pragmasReady} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';
import {recordAdminAudit} from '@/lib/admin/management-service';
import {decryptProviderSecret} from '@/lib/ai/providers/secret';

export class AiModelError extends Error{constructor(message:string,public status=400){super(message);}}
const secrets={secretCiphertext:true,secretNonce:true,secretTag:true} as const;
function object(input:unknown){if(!input||typeof input!=='object'||Array.isArray(input))throw new AiModelError('模型配置格式无效。');return input as Record<string,unknown>;}
function text(value:unknown,label:string,max:number){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new AiModelError(`${label}格式无效。`);return value.trim();}
function integer(value:unknown,label:string,min:number,max:number){if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>max)throw new AiModelError(`${label}超出允许范围。`);return value as number;}
function reason(value:unknown){return text(value,'操作理由',300);}
function expected(value:unknown){return integer(value,'版本信息',0,2147483647);}
async function requirePermission(actorId:string,permission:'ai.models.read'|'ai.models.manage'|'ai.models.test'|'ai.providers.read',tx?:Parameters<typeof hasAdminPermission>[2]){if(!await hasAdminPermission(actorId,permission,tx))throw new AiModelError('当前账号没有此管理权限。',403);}
function view(row:Awaited<ReturnType<typeof db.aiModel.findMany>>[number]&{provider:{id:string;name:string;isActive:boolean}}){return {...row,provider:{id:row.provider.id,name:row.provider.name,isActive:row.provider.isActive}};}

export async function readAiModels(actorId:string){
  await requirePermission(actorId,'ai.models.read');
  return db.$transaction(async tx=>{await requirePermission(actorId,'ai.models.read',tx);const rows=await tx.aiModel.findMany({include:{provider:{select:{id:true,name:true,isActive:true}}},orderBy:[{sortOrder:'asc'},{key:'asc'}],take:200});return rows.map(view);});
}

export async function saveAiModel(actorId:string,input:unknown){
  const row=object(input),allowed=new Set(['id','key','displayName','modelCode','providerId','isActive','isDefault','isFallback','sortOrder','timeoutMs','maxRetries','maxOutputTokens','version','reason']);
  if(Object.keys(row).some(key=>!allowed.has(key)))throw new AiModelError('模型字段与当前表单不匹配。');
  const key=text(row.key,'模型标识',64),displayName=text(row.displayName,'显示名称',80),modelCode=text(row.modelCode,'供应商模型代码',120),providerId=text(row.providerId,'供应商',100);
  if(!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(key)||! /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(modelCode))throw new AiModelError('模型标识或供应商代码包含不支持的字符。');
  if(typeof row.isActive!=='boolean'||typeof row.isDefault!=='boolean'||typeof row.isFallback!=='boolean'||!Number.isSafeInteger(row.sortOrder))throw new AiModelError('模型状态或排序无效。');
  const isActive=row.isActive,isDefault=row.isDefault,isFallback=row.isFallback,sortOrder=integer(row.sortOrder,'排序值',0,100000),timeoutMs=integer(row.timeoutMs,'连接超时',1000,120000),maxRetries=integer(row.maxRetries,'重试次数',0,2),maxOutputTokens=integer(row.maxOutputTokens,'最大输出Token',1,200000),explanation=reason(row.reason);
  if(isDefault&&(!isActive||isFallback)||isFallback&&isDefault)throw new AiModelError('默认模型必须启用且不能同时标记为备用模型。');
  const id=typeof row.id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(row.id)?row.id:undefined;if(row.id!==undefined&&!id)throw new AiModelError('模型编号无效。');const version=id?expected(row.version):0;
  await pragmasReady;
  try{return await db.$transaction(async tx=>{
    await tx.$executeRaw`UPDATE admin_operators SET version = version WHERE user_id = ${actorId}`;await requirePermission(actorId,'ai.models.manage',tx);await requirePermission(actorId,'ai.providers.read',tx);
    const before=id?await tx.aiModel.findUnique({where:{id},include:{provider:{select:{id:true,name:true,isActive:true}}}}):null;if(id&&!before)throw new AiModelError('模型不存在。',404);if((before?.version??0)!==version)throw new AiModelError('模型配置已被其他人修改，请刷新后重试。',409);
    const provider=await tx.aiProvider.findUnique({where:{id:providerId},select:{id:true,name:true,isActive:true,...secrets}});if(!provider)throw new AiModelError('供应商不存在。',404);
    if(isActive){if(!provider.isActive)throw new AiModelError('启用模型前请先启用所属供应商。');try{decryptProviderSecret(provider);}catch{throw new AiModelError('启用模型前请先检查供应商密钥和服务端加密密钥。',409);}}
    const activeOthers=await tx.aiModel.findMany({where:{isActive:true,...(id?{id:{not:id}}:{})},select:{id:true,isDefault:true}});
    const defaultCount=isActive&&isDefault?1:activeOthers.filter(item=>item.isDefault).length;
    if(isActive&&defaultCount!==1)throw new AiModelError('启用模型时必须且只能有一个默认模型；请先指定默认模型。');
    if(!isActive&&before?.isActive&&before.isDefault&&activeOthers.length)throw new AiModelError('请先将其他启用模型设为默认模型，再停用当前默认模型。',409);
    if(before&&key!==before.key)throw new AiModelError('模型标识启用后不可更改；如需替换请创建新标识。',409);
    const displacedDefaults=isDefault?activeOthers.filter(item=>item.isDefault):[];
    if(displacedDefaults.length)await tx.aiModel.updateMany({where:{id:{in:displacedDefaults.map(item=>item.id)}},data:{isDefault:false,defaultSlot:null,version:{increment:1}}});
    const data={key,displayName,modelCode,providerId,isActive,isDefault,defaultSlot:isDefault?'GLOBAL':null,isFallback,sortOrder,timeoutMs,maxRetries,maxOutputTokens};
    const saved=before?await tx.aiModel.update({where:{id:before.id},data:{...data,version:{increment:1},lastCheckAt:null,lastCheckStatus:null}}):await tx.aiModel.create({data:{id:randomUUID(),...data,version:1}});
    await recordAdminAudit(tx,actorId,before?'UPDATE_AI_MODEL':'CREATE_AI_MODEL',saved.id,explanation,{before:before?{key:before.key,displayName:before.displayName,modelCode:before.modelCode,providerId:before.providerId,isActive:before.isActive,isDefault:before.isDefault,isFallback:before.isFallback,version:before.version}:null,after:{key,displayName,modelCode,providerId,isActive,isDefault,isFallback,version:saved.version},displacedDefaults:displacedDefaults.map(item=>item.id)});
    return view({...saved,provider:{id:provider.id,name:provider.name,isActive:provider.isActive}});
  });}catch(error){if(error instanceof AiModelError)throw error;if((error as {code?:string})?.code==='P2002')throw new AiModelError('模型标识或供应商模型代码已存在。',409);throw error;}
}

export async function testAiModel(actorId:string,id:string){
  await requirePermission(actorId,'ai.models.test');if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new AiModelError('模型编号无效。');
  const model=await db.$transaction(async tx=>{await requirePermission(actorId,'ai.models.test',tx);return tx.aiModel.findUnique({where:{id},include:{provider:{select:{id:true,name:true,baseUrl:true,...secrets}}}});});if(!model)throw new AiModelError('模型不存在。',404);
  let apiKey:string;try{apiKey=decryptProviderSecret(model.provider);}catch{throw new AiModelError('无法解密供应商密钥，请检查服务端加密密钥。',503);}
  let status:number|null=null,listed:boolean|null=null;const started=Date.now();
  try{const response=await fetch(`${model.provider.baseUrl}/models`,{headers:{Authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'});status=response.status;if(response.ok){try{const body=await response.json() as {data?:Array<{id?:unknown}>;models?:Array<{id?:unknown}>};const entries=Array.isArray(body.data)?body.data:body.models;listed=Array.isArray(entries)?entries.some(item=>item.id===model.modelCode):null;}catch{listed=null;}}else await response.body?.cancel().catch(()=>{});}catch{}
  const result={reachable:status!==null,authorized:status!==null&&status>=200&&status<300,status,modelListed:listed,latencyMs:Date.now()-started};const checkStatus=!result.reachable?'UNAVAILABLE':!result.authorized?'REJECTED':listed===false?'NOT_LISTED':'AVAILABLE';
  await db.$transaction(async tx=>{await requirePermission(actorId,'ai.models.test',tx);await tx.aiModel.update({where:{id},data:{lastCheckAt:new Date(),lastCheckStatus:checkStatus}});await recordAdminAudit(tx,actorId,'TEST_AI_MODEL',id,'检查模型连接',result);});
  return result;
}
