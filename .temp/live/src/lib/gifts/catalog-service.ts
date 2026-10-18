import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {db,pragmasReady} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';
import {recordAdminAudit} from '@/lib/admin/management-service';

export class GiftCatalogError extends Error{
  constructor(message:string,public status=400){super(message);this.name='GiftCatalogError';}
}

function object(input:unknown){if(!input||typeof input!=='object'||Array.isArray(input))throw new GiftCatalogError('礼物配置格式错误。');return input as Record<string,unknown>;}
async function requireGrowth(actor:string,permission:'growth.read'|'growth.manage',tx?:Prisma.TransactionClient){if(!await hasAdminPermission(actor,permission,tx))throw new GiftCatalogError('当前账号没有礼物目录管理权限。',403);}
async function claimWriter(tx:Prisma.TransactionClient,actor:string){await tx.$executeRaw`UPDATE admin_operators SET version = version WHERE user_id = ${actor}`;}

const publicSelect={id:true,code:true,name:true,description:true,emoji:true,coinPrice:true,sortOrder:true} as const;

export async function readPublicGiftCatalog(){
  await pragmasReady;
  return db.giftCatalogItem.findMany({where:{isActive:true},orderBy:[{sortOrder:'asc'},{id:'asc'}],take:100,select:publicSelect});
}

export async function readManagedGiftCatalog(actor:string){
  await pragmasReady;
  return db.$transaction(async tx=>{await requireGrowth(actor,'growth.read',tx);return {gifts:await tx.giftCatalogItem.findMany({orderBy:[{sortOrder:'asc'},{createdAt:'asc'},{id:'asc'}],take:100})};});
}

export async function saveGiftCatalogItem(actor:string,input:unknown){
  const body=object(input),id=body.id;
  const code=typeof body.code==='string'?body.code.trim().toLowerCase():'';
  if(!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(code))throw new GiftCatalogError('礼物代码须为 2–40 位小写字母、数字、下划线或短横线。');
  const name=typeof body.name==='string'?body.name.trim():'';
  if(!name||name.length>60)throw new GiftCatalogError('礼物名称须为 1–60 字。');
  const description=body.description===null||body.description===undefined?'':typeof body.description==='string'?body.description.trim():null;
  if(description===null||description.length>400)throw new GiftCatalogError('礼物说明最多 400 字。');
  const emoji=typeof body.emoji==='string'?body.emoji.trim():'';
  if(!emoji||Array.from(emoji).length>8)throw new GiftCatalogError('礼物图标须为 1–8 个字符。');
  if(!Number.isSafeInteger(body.coinPrice)||Number(body.coinPrice)<1||Number(body.coinPrice)>1000000)throw new GiftCatalogError('金币价格须为 1–1000000。');
  if(!Number.isSafeInteger(body.sortOrder)||Number(body.sortOrder)<0||Number(body.sortOrder)>100000)throw new GiftCatalogError('排序值无效。');
  if(typeof body.isActive!=='boolean')throw new GiftCatalogError('礼物启用状态无效。');
  if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.trim().length>500)throw new GiftCatalogError('请填写 1–500 字操作理由。');
  if(id!==undefined&&(typeof id!=='string'||!/^[-A-Za-z0-9_]{1,100}$/.test(id)))throw new GiftCatalogError('礼物编号无效。');
  if(id&&(!Number.isSafeInteger(body.version)||Number(body.version)<0))throw new GiftCatalogError('礼物版本无效，请刷新后重试。');
  const reason=body.reason.trim();await pragmasReady;
  return db.$transaction(async tx=>{
    await claimWriter(tx,actor);await requireGrowth(actor,'growth.manage',tx);
    const before=id?await tx.giftCatalogItem.findUnique({where:{id}}):null;
    if(id&&!before)throw new GiftCatalogError('礼物不存在。',404);
    if(before&&before.version!==body.version)throw new GiftCatalogError('礼物目录已被其他操作修改，请刷新。',409);
    if(before&&before.code!==code)throw new GiftCatalogError('礼物代码创建后不可更改；请停用旧礼物并新建。',409);
    const values={name,description:description||null,emoji,coinPrice:Number(body.coinPrice),isActive:body.isActive as boolean,sortOrder:Number(body.sortOrder)};
    const saved=before
      ?await tx.giftCatalogItem.update({where:{id:before.id},data:{...values,version:{increment:1}}})
      :await tx.giftCatalogItem.create({data:{id:randomUUID().replaceAll('-',''),code,...values,version:1}});
    await recordAdminAudit(tx,actor,before?'UPDATE_GIFT_CATALOG':'CREATE_GIFT_CATALOG',saved.id,reason,{before:before?{code:before.code,name:before.name,coinPrice:before.coinPrice,isActive:before.isActive,version:before.version}:null,after:{code:saved.code,name:saved.name,coinPrice:saved.coinPrice,isActive:saved.isActive,version:saved.version}});
    return saved;
  }).catch(error=>{
    if(typeof error==='object'&&error!==null&&'code'in error&&error.code==='P2002')throw new GiftCatalogError('礼物代码已存在。',409);
    throw error;
  });
}
