import {db,pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {grantEarnedCoins} from '@rumiai/backend/modules/coins/reward-ledger';
import {notifyCoinsReceived} from '@rumiai/backend/modules/notifications/write';
import {notifySafely} from '@rumiai/backend/modules/notifications/emit';

export class CheckinError extends Error{
  constructor(message:string,public status=400){super(message);this.name='CheckinError';}
}

function localMidnight(value:Date){const day=new Date(value);day.setHours(0,0,0,0);return day;}

export async function readCheckinStatus(userId:string){
  await pragmasReady;
  const user=await db.user.findUnique({where:{id:userId},select:{coins:true,streakCount:true,lastCheckin:true}});
  if(!user)throw new CheckinError('账号不存在。',404);
  const today=localMidnight(new Date()),last=user.lastCheckin?localMidnight(user.lastCheckin):null;
  const yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
  const nextDay=last?.getTime()===today.getTime()||last?.getTime()===yesterday.getTime()?user.streakCount+1:1;
  const rule=await db.checkinRewardRule.findUnique({where:{streakDay:Math.min(nextDay,7)},select:{rewardCoins:true}});
  if(!rule)throw new CheckinError('签到奖励规则尚未配置。',503);
  return {checkedInToday:last?.getTime()===today.getTime(),streakDay:user.streakCount,nextCoins:rule.rewardCoins,coins:user.coins};
}

export async function claimDailyCheckin(userId:string){
  await pragmasReady;
  const user=await db.user.findUnique({where:{id:userId},select:{lastCheckin:true,streakCount:true}});
  if(!user)throw new CheckinError('账号不存在。',404);
  const now=new Date(),today=localMidnight(now),last=user.lastCheckin?localMidnight(user.lastCheckin):null;
  if(last?.getTime()===today.getTime())throw new CheckinError('今天已经签到。',409);
  const yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
  const newStreak=last?.getTime()===yesterday.getTime()?user.streakCount+1:1;
  const streakDay=Math.min(newStreak,7);
  return db.$transaction(async tx=>{
    const policy=await tx.checkinRewardRule.findUnique({where:{streakDay},select:{rewardCoins:true}});
    if(!policy)throw new CheckinError('签到奖励规则尚未配置。',503);
    const updated=await tx.user.updateMany({
      where:{id:userId,lastCheckin:user.lastCheckin},
      data:{streakCount:newStreak,lastCheckin:now},
    });
    if(!updated.count)throw new CheckinError('今天已经签到。',409);
    await tx.checkin.create({data:{userId,coinsEarned:policy.rewardCoins,streakDay:newStreak,checkedInAt:now}});
    const totalCoins=await grantEarnedCoins(tx,userId,policy.rewardCoins,`每日签到第 ${newStreak} 天`,'CHECKIN_REWARD');
    return {success:true,coinsEarned:policy.rewardCoins,streakDay:newStreak,totalCoins};
  },{maxWait:10_000,timeout:15_000}).then(async result=>{
    // 签到奖励到账通知：事务提交后才写，事件键用业务日，同一天重放不会重复通知（V3 §26）。
    if(result.coinsEarned>0)await notifySafely(()=>notifyCoinsReceived({
      userId,transactionId:`checkin:${new Date(now).toISOString().slice(0,10)}`,amount:result.coinsEarned,
      reason:`每日签到第 ${result.streakDay} 天奖励已到账`,
    }),'checkin_reward');
    return result;
  });
}
