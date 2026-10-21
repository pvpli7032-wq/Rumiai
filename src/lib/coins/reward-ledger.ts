import type {Prisma} from '@prisma/client';

const MAX_COIN_BALANCE=2_000_000_000;

/**
 * Apply an earned balance and its ledger row in the caller's business transaction.
 *
 * `rewardKey` 是「同一笔奖励只发一次」的唯一业务键（评理参与奖、热门奖、邀请奖）。
 * 键重复时由唯一约束拦下，调用方据此判断这次是否真的发出去；余额与流水在同一事务里，
 * 不会出现「加了币却没流水」或「有流水却没加币」。
 */
export async function grantEarnedCoins(tx:Prisma.TransactionClient,userId:string,amount:number,description:string,sourceKey:string='OTHER',rewardKey?:string|null){
  if(!Number.isSafeInteger(amount)||amount<0||amount>MAX_COIN_BALANCE)throw new Error('Earned coin amount is outside the supported range.');
  if(amount===0)return (await tx.user.findUnique({where:{id:userId},select:{coins:true}}))?.coins??0;
  const user=await tx.user.update({where:{id:userId},data:{coins:{increment:amount}},select:{coins:true}});
  await tx.coinTransaction.create({data:{userId,amount,type:'EARNED',sourceKey,description,rewardKey:rewardKey??null}});
  return user.coins;
}

/** True when the write failed because this rewardKey was already granted. */
export function isDuplicateReward(error:unknown){
  return typeof error==='object'&&error!==null&&(error as {code?:string}).code==='P2002';
}

/** Conditionally debit a balance and write the spend row without a check/write race. */
export async function spendCoins(tx:Prisma.TransactionClient,userId:string,amount:number,description:string,sourceKey:string='OTHER'){
  if(!Number.isSafeInteger(amount)||amount<1||amount>MAX_COIN_BALANCE)throw new Error('Spent coin amount is outside the supported range.');
  const debited=await tx.user.updateMany({where:{id:userId,coins:{gte:amount}},data:{coins:{decrement:amount}}});
  if(!debited.count)return null;
  await tx.coinTransaction.create({data:{userId,amount:-amount,type:'SPENT',sourceKey,description}});
  return tx.user.findUnique({where:{id:userId},select:{coins:true}});
}
