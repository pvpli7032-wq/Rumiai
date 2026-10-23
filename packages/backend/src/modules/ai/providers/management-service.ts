import {randomUUID} from 'node:crypto';
import {db,pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {hasAdminPermission} from '@rumiai/backend/modules/admin/authorization';
import {recordAdminAudit} from '@rumiai/backend/modules/admin/management-service';
import {decryptProviderSecret,encryptProviderSecret,validateProviderBaseUrl} from './secret';

export class AiProviderError extends Error{constructor(message:string,public status=400){super(message);}}
const secretSelect={secretCiphertext:true,secretNonce:true,secretTag:true} as const;
const publicSelect={id:true,name:true,protocol:true,baseUrl:true,isActive:true,sortOrder:true,version:true,createdAt:true,updatedAt:true} as const;
function object(input:unknown){if(!input||typeof input!=='object'||Array.isArray(input))throw new AiProviderError('供应商配置格式无效。');return input as Record<string,unknown>;}
function requiredText(value:unknown,label:string,max:number){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new AiProviderError(`${label}格式无效。`);return value.trim();}
function expectedVersion(value:unknown){if(!Number.isSafeInteger(value)||(value as number)<0)throw new AiProviderError('配置版本无效。');return value as number;}
function explanation(value:unknown){return requiredText(value,'操作理由',300);}
async function requirePermission(actorId:string,permission:'ai.providers.read'|'ai.providers.manage'|'ai.providers.secrets.manage'|'ai.providers.test',tx?:Parameters<typeof hasAdminPermission>[2]){
  if(!await hasAdminPermission(actorId,permission,tx))throw new AiProviderError('当前账号没有此管理权限。',403);
}
function publicProvider(row:Awaited<ReturnType<typeof db.aiProvider.findMany>>[number]){
  const {secretCiphertext,secretNonce,secretTag,...publicFields}=row;
  return {...publicFields,hasSecret:Boolean(secretCiphertext&&secretNonce&&secretTag)};
}

export async function readAiProviders(actorId:string){
  await requirePermission(actorId,'ai.providers.read');
  return db.$transaction(async tx=>{await requirePermission(actorId,'ai.providers.read',tx);const rows=await tx.aiProvider.findMany({select:{...publicSelect,...secretSelect},orderBy:[{sortOrder:'asc'},{id:'asc'}],take:100});return rows.map(publicProvider);});
}

export async function saveAiProvider(actorId:string,input:unknown){
  const row=object(input),name=requiredText(row.name,'供应商名称',60),protocol=row.protocol??'OPENAI_COMPATIBLE';
  const allowed=new Set(['id','name','baseUrl','protocol','isActive','sortOrder','version','apiKey','clearSecret','reason']);
  if(Object.keys(row).some(key=>!allowed.has(key)))throw new AiProviderError('供应商字段与当前表单不匹配。');
  let baseUrl:string;try{baseUrl=validateProviderBaseUrl(row.baseUrl);}catch(error){throw new AiProviderError(error instanceof Error?error.message:'服务地址无效。');}
  if(protocol!=='OPENAI_COMPATIBLE')throw new AiProviderError('当前仅支持 OpenAI 兼容协议。');
  if(typeof row.isActive!=='boolean'||!Number.isSafeInteger(row.sortOrder)||(row.sortOrder as number)<0||(row.sortOrder as number)>100000)throw new AiProviderError('启用状态或排序值无效。');
  const isActive=row.isActive;
  if(row.clearSecret!==undefined&&typeof row.clearSecret!=='boolean')throw new AiProviderError('密钥清除状态无效。');
  const reason=explanation(row.reason),secret=row.apiKey;
  if(secret!==undefined&&typeof secret!=='string')throw new AiProviderError('API 密钥格式无效。');
  if(typeof secret==='string'&&secret.trim())await requirePermission(actorId,'ai.providers.secrets.manage');
  let encrypted:ReturnType<typeof encryptProviderSecret>|null=null;
  if(typeof secret==='string'&&secret.trim()){try{encrypted=encryptProviderSecret(secret.trim());}catch{throw new AiProviderError('服务器尚未配置 AI_PROVIDER_ENCRYPTION_KEY，暂时不能保存密钥。',503);}}
  if(row.clearSecret===true){await requirePermission(actorId,'ai.providers.secrets.manage');}
  const id=typeof row.id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(row.id)?row.id:undefined;
  if(row.id!==undefined&&!id)throw new AiProviderError('供应商编号无效。');
  const version=id?expectedVersion(row.version):0;
  await pragmasReady;
  try{return await db.$transaction(async tx=>{
    await tx.$executeRaw`UPDATE admin_operators SET version = version WHERE user_id = ${actorId}`;
    await requirePermission(actorId,'ai.providers.manage',tx);
    if(typeof secret==='string'&&secret.trim())await requirePermission(actorId,'ai.providers.secrets.manage',tx);
    if(row.clearSecret===true)await requirePermission(actorId,'ai.providers.secrets.manage',tx);
    const before=id?await tx.aiProvider.findUnique({where:{id},select:{...publicSelect,...secretSelect}}):null;
    if(id&&!before)throw new AiProviderError('供应商不存在。',404);
    if((before?.version??0)!==version)throw new AiProviderError('供应商配置已被其他人修改，请刷新后重试。',409);
    if(before&&!row.isActive&&await tx.aiModel.count({where:{providerId:before.id,isActive:true}}))throw new AiProviderError('该供应商仍有启用模型；请先停用或迁移这些模型。',409);
    if(isActive&&!before?.isActive&&await tx.aiProvider.count({where:{isActive:true}})>=10)throw new AiProviderError('最多同时启用 10 个 AI 供应商。');
    const keyFields=encrypted??(row.clearSecret===true?{secretCiphertext:null,secretNonce:null,secretTag:null}:before?{secretCiphertext:before.secretCiphertext,secretNonce:before.secretNonce,secretTag:before.secretTag}:{secretCiphertext:null,secretNonce:null,secretTag:null});
    if(isActive&&!(keyFields.secretCiphertext&&keyFields.secretNonce&&keyFields.secretTag))throw new AiProviderError('启用供应商前请先设置 API 密钥。');
    const data={name,protocol,baseUrl,isActive,sortOrder:row.sortOrder as number,...keyFields};
    const saved=before?await tx.aiProvider.update({where:{id:before.id},data:{...data,version:{increment:1}}}):await tx.aiProvider.create({data:{id:randomUUID(),...data,version:1}});
    await recordAdminAudit(tx,actorId,before?'UPDATE_AI_PROVIDER':'CREATE_AI_PROVIDER',saved.id,reason,{before:before?{name:before.name,baseUrl:before.baseUrl,isActive:before.isActive,sortOrder:before.sortOrder,hasSecret:Boolean(before.secretCiphertext),version:before.version}:null,after:{name,baseUrl,isActive,sortOrder:row.sortOrder,hasSecret:Boolean(keyFields.secretCiphertext),version:saved.version}});
    return publicProvider(saved as typeof saved & {secretCiphertext:string|null;secretNonce:string|null;secretTag:string|null});
  });}catch(error){if(error instanceof AiProviderError)throw error;if((error as {code?:string})?.code==='P2002')throw new AiProviderError('供应商名称已存在。',409);throw error;}
}

export async function testAiProvider(actorId:string,id:string){
  await requirePermission(actorId,'ai.providers.test');
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new AiProviderError('供应商编号无效。');
  const row=await db.$transaction(async tx=>{await requirePermission(actorId,'ai.providers.test',tx);return tx.aiProvider.findUnique({where:{id},select:{id:true,name:true,baseUrl:true,...secretSelect}});});
  if(!row)throw new AiProviderError('供应商不存在。',404);
  if(!row.secretCiphertext)throw new AiProviderError('请先配置供应商 API 密钥。',409);
  let apiKey:string;try{apiKey=decryptProviderSecret(row);}catch{throw new AiProviderError('无法解密供应商密钥，请检查服务端加密密钥配置。',503);}
  const started=Date.now();
  try{
    const response=await fetch(`${row.baseUrl}/models`,{headers:{Authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'});
    await response.body?.cancel().catch(()=>{});
    const result={reachable:true,authorized:response.ok,status:response.status,latencyMs:Date.now()-started};
    await db.$transaction(async tx=>{await requirePermission(actorId,'ai.providers.test',tx);await recordAdminAudit(tx,actorId,'TEST_AI_PROVIDER',row.id,'测试供应商连接',result);});
    return result;
  }catch{
    const result={reachable:false,authorized:false,status:null,latencyMs:Date.now()-started};
    await db.$transaction(async tx=>{await requirePermission(actorId,'ai.providers.test',tx);await recordAdminAudit(tx,actorId,'TEST_AI_PROVIDER',row.id,'测试供应商连接',result);});
    return result;
  }
}

export async function readActiveAiProviders(){
  const rows=await db.aiProvider.findMany({where:{isActive:true},select:{id:true,name:true,baseUrl:true,...secretSelect},orderBy:[{sortOrder:'asc'},{id:'asc'}],take:10});
  return rows.flatMap(row=>{try{return[{id:row.id,name:row.name,baseUrl:row.baseUrl,apiKey:decryptProviderSecret(row)}];}catch{return[];}});
}
