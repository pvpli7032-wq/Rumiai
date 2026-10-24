import type {Prisma} from '@prisma/client';
import {db,pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {spendCoins} from '@rumiai/backend/modules/coins/reward-ledger';
import {growthModuleAdapter} from '@rumiai/backend/modules/growth/modules/registry';

export class GiftSendError extends Error{
  constructor(message:string,public status=400){super(message);this.name='GiftSendError';}
}

function inputObject(input:unknown){if(!input||typeof input!=='object'||Array.isArray(input))throw new GiftSendError('礼物请求格式无效。');return input as Record<string,unknown>;}

async function send(tx:Prisma.TransactionClient,userId:string,characterId:string,input:Record<string,unknown>){
  if(!await growthModuleAdapter('gifts').isEnabled(tx))throw new GiftSendError('礼物玩法当前已停用，历史赠送记录仍会保留。',409);
  const catalogId=input.giftId,rawCode=input.giftCode??input.giftType??input.type??(catalogId===undefined?'rose':undefined);
  if(catalogId!==undefined&&(typeof catalogId!=='string'||catalogId.length>100))throw new GiftSendError('礼物编号无效。');
  if(rawCode!==undefined&&(typeof rawCode!=='string'||!/^[-a-z0-9_]{2,40}$/i.test(rawCode)))throw new GiftSendError('礼物代码无效。');
  const quotes=[input.amount,input.giftAmount].filter(value=>value!==undefined);
  if(quotes.some(value=>typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>1000000))throw new GiftSendError('礼物金币报价无效。');
  if(quotes.length===2&&quotes[0]!==quotes[1])throw new GiftSendError('礼物报价不一致。');
  const item=catalogId!==undefined
    ?await tx.giftCatalogItem.findFirst({where:{id:catalogId as string,isActive:true}})
    :await tx.giftCatalogItem.findFirst({where:{code:(rawCode as string).toLowerCase(),isActive:true}});
  if(!item)throw new GiftSendError('礼物不存在或当前不可赠送。',404);
  if(rawCode!==undefined&&item.code!==(rawCode as string).toLowerCase())throw new GiftSendError('礼物编号与代码不匹配。',409);
  if(quotes.length&&quotes[0]!==item.coinPrice)throw new GiftSendError('礼物价格已更新，请刷新目录后重试。',409);
  const character=await tx.character.findUnique({where:{id:characterId},select:{id:true,name:true,isPublic:true,reviewStatus:true,creatorId:true,giftCount:true}});
  if(!character)throw new GiftSendError('角色不存在。',404);
  if((!character.isPublic||character.reviewStatus!=='APPROVED')&&character.creatorId!==userId)throw new GiftSendError('当前角色不可赠礼。',403);
  const debit=await spendCoins(tx,userId,item.coinPrice,`赠送礼物 ${item.code} 给 ${character.name}`,'GIFT_PURCHASE');
  if(!debit)throw new GiftSendError('金币余额不足。',400);
  await tx.character.update({where:{id:characterId},data:{giftCount:{increment:1}}});
  const gift=await tx.gift.create({data:{senderId:userId,characterId,catalogId:item.id,amount:item.coinPrice,giftType:item.code}});
  return {gift,coinPrice:item.coinPrice,newBalance:debit.coins};
}

export async function sendCatalogGift(userId:string,characterId:string,input:unknown){
  const body=inputObject(input);
  if(typeof characterId!=='string'||!characterId||characterId.length>100)throw new GiftSendError('角色编号无效。');
  await pragmasReady;
  return db.$transaction(tx=>send(tx,userId,characterId,body),{maxWait:10_000,timeout:15_000});
}
