import type {Prisma} from '@prisma/client';
import {db,pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {grantEarnedCoins} from '@rumiai/backend/modules/coins/reward-ledger';
import type {MissionCondition,MissionPeriod} from '@rumiai/backend/modules/missions/management-service';

export class MissionClaimError extends Error{
  constructor(message:string,public status=409,public progress?:number,public target?:number){super(message);this.name='MissionClaimError';}
}

function periodWindow(period:MissionPeriod,now:Date){
  if(period==='ONCE')return {key:'ONCE',since:null as Date|null};
  const since=new Date(now);since.setUTCHours(0,0,0,0);
  if(period==='WEEKLY')since.setUTCDate(since.getUTCDate()-((since.getUTCDay()+6)%7));
  return {key:(period==='DAILY'?'D:':'W:')+since.toISOString().slice(0,10),since};
}

function missionIsOpen(mission:{isActive:boolean;startsAt:Date|null;endsAt:Date|null},now:Date){
  return mission.isActive&&(!mission.startsAt||mission.startsAt<=now)&&(!mission.endsAt||now<mission.endsAt);
}

function missionProgressStart(mission:{createdAt:Date;startsAt:Date|null},periodStart:Date|null){
  const configuredStart=mission.startsAt??mission.createdAt;
  return periodStart&&periodStart>configuredStart?periodStart:configuredStart;
}

async function countProgress(tx:Prisma.TransactionClient,userId:string,condition:MissionCondition,since:Date|null,now:Date){
  const createdAt={...(since?{gte:since}:{}),lte:now};
  if(condition==='CHECKIN_COUNT')return tx.checkin.count({where:{userId,checkedInAt:createdAt}});
  if(condition==='MESSAGE_COUNT')return tx.message.count({where:{role:'USER',createdAt,conversation:{userId}}});
  if(condition==='POST_COUNT')return tx.post.count({where:{authorId:userId,status:'VISIBLE',createdAt}});
  if(condition==='COMMENT_COUNT')return tx.postComment.count({where:{authorId:userId,status:'VISIBLE',createdAt}});
  return 0;
}

export async function readUserMissions(userId:string){
  await pragmasReady;
  return db.$transaction(async tx=>{
    const now=new Date();
    const missions=await tx.mission.findMany({where:{isActive:true,OR:[{startsAt:null},{startsAt:{lte:now}}],AND:[{OR:[{endsAt:null},{endsAt:{gt:now}}]}]},orderBy:[{sortOrder:'asc'},{createdAt:'desc'}],take:200});
    const claims=missions.length?await tx.userMission.findMany({where:{userId,missionId:{in:missions.map(row=>row.id)}},select:{missionId:true,periodKey:true,completedAt:true}}):[];
    const claimByKey=new Map(claims.map(row=>[`${row.missionId}:${row.periodKey}`,row]));
    const progressCache=new Map<string,number>();
    const result=[];
    for(const mission of missions){
      if(mission.conditionType==='MANUAL')continue;
      const period=mission.period as MissionPeriod,condition=mission.conditionType as MissionCondition,window=periodWindow(period,now);
      const since=missionProgressStart(mission,window.since);
      const progressKey=`${condition}:${window.key}:${since.toISOString()}`;
      if(!progressCache.has(progressKey))progressCache.set(progressKey,await countProgress(tx,userId,condition,since,now));
      const progress=progressCache.get(progressKey)??0,claim=claimByKey.get(`${mission.id}:${window.key}`)??null;
      result.push({id:mission.id,title:mission.title,description:mission.description,rewardCoins:mission.rewardCoins,category:mission.category,conditionType:condition,conditionTarget:mission.conditionTarget,period,periodKey:window.key,progress:Math.min(progress,mission.conditionTarget),qualified:progress>=mission.conditionTarget,isCompleted:Boolean(claim),completedAt:claim?.completedAt??null});
    }
    return result;
  });
}

export async function claimMissionReward(userId:string,missionId:string){
  await pragmasReady;
  try{
    return await db.$transaction(async tx=>{
      const mission=await tx.mission.findUnique({where:{id:missionId}});
      if(!mission)throw new MissionClaimError('任务不存在。',404);
      const now=new Date();
      if(!missionIsOpen(mission,now)||mission.conditionType==='MANUAL')throw new MissionClaimError('任务当前不可领取。');
      const period=mission.period as MissionPeriod,window=periodWindow(period,now),condition=mission.conditionType as MissionCondition;
      const progress=await countProgress(tx,userId,condition,missionProgressStart(mission,window.since),now);
      if(progress<mission.conditionTarget)throw new MissionClaimError('任务条件尚未完成。',409,progress,mission.conditionTarget);
      await tx.userMission.create({data:{userId,missionId,periodKey:window.key,isCompleted:true,completedAt:now}});
      const newBalance=await grantEarnedCoins(tx,userId,mission.rewardCoins,`任务奖励：${mission.title}`,'MISSION_REWARD');
      return {coinsEarned:mission.rewardCoins,newBalance,periodKey:window.key};
    },{maxWait:10_000,timeout:15_000});
  }catch(error){
    if(typeof error==='object'&&error!==null&&'code'in error&&error.code==='P2002')throw new MissionClaimError('该周期的任务奖励已领取。',409);
    throw error;
  }
}
