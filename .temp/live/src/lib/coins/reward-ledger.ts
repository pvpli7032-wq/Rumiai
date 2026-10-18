import type {Prisma} from '@prisma/client';

const MAX_COIN_BALANCE=2_000_000_000;

/** Apply an earned balance and its ledger row in the caller's business transaction. */
export async function grantEarnedCoins(tx:Prisma.TransactionClient,userId:string,amount:number,description:string,sourceKey:string='OTHER'){
  if(!Number.isSafeInteger(amount)||amount<0||amount>MAX_COIN_BALANCE)throw new Error('Earned coin amount is outside the supported range.');
  const user=await tx.user.update({where:{id:userId},data:{coins:{increment:amount}},select:{coins:true}});
  if(amount>0)await tx.coinTransaction.create({data:{userId,amount,type:'EARNED',sourceKey,description}});
  return user.coins;
}

/** Conditionally debit a balance and write the spend row without a check/write race. */
export async function spendCoins(tx:Prisma.TransactionClient,userId:string,amount:number,description:string,sourceKey:string='OTHER'){
  if(!Number.isSafeInteger(amount)||amount<1||amount>MAX_COIN_BALANCE)throw new Error('Spent coin amount is outside the supported range.');
  const debited=await tx.user.updateMany({where:{id:userId,coins:{gte:amount}},data:{coins:{decrement:amount}}});
  if(!debited.count)return null;
  await tx.coinTransaction.create({data:{userId,amount:-amount,type:'SPENT',sourceKey,description}});
  return tx.user.findUnique({where:{id:userId},select:{coins:true}});
}
