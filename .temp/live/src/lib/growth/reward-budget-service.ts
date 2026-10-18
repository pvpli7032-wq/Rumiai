import type {Prisma} from '@prisma/client';
import {db,pragmasReady} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';

const SOURCES=[
  {key:'CHECKIN_REWARD',label:'每日签到'},
  {key:'MISSION_REWARD',label:'平台任务'},
  {key:'CHARACTER_QUEST_REWARD',label:'角色任务'},
] as const;

export class RewardBudgetReportError extends Error{
  constructor(message:string,status=400){super(message);this.name='RewardBudgetReportError';this.status=status;}
  status:number;
}

type DailyRow={source_key:string;day:string;claims:number;coins:number};

export async function readRewardBudgetReport(actorId:string,days:number){
  if(![7,30,90].includes(days))throw new RewardBudgetReportError('统计周期只能为 7、30 或 90 天。');
  await pragmasReady;
  return db.$transaction(async tx=>{
    if(!await hasAdminPermission(actorId,'growth.read',tx))throw new RewardBudgetReportError('当前账号没有任务与奖励查看权限。',403);
    const generatedAt=new Date(),since=new Date(generatedAt.getTime()-days*86400000);
    const rows=await tx.$queryRaw<DailyRow[]>`
      SELECT source_key,day,SUM(claims) AS claims,SUM(coins) AS coins FROM (
        SELECT 'CHECKIN_REWARD' AS source_key,date(checked_in_at / 1000.0,'unixepoch') AS day,COUNT(*) AS claims,0 AS coins FROM checkins WHERE checked_in_at >= ${since} AND checked_in_at <= ${generatedAt} GROUP BY date(checked_in_at / 1000.0,'unixepoch')
        UNION ALL
        SELECT 'MISSION_REWARD' AS source_key,date(completed_at / 1000.0,'unixepoch') AS day,COUNT(*) AS claims,0 AS coins FROM user_missions WHERE is_completed=1 AND completed_at >= ${since} AND completed_at <= ${generatedAt} GROUP BY date(completed_at / 1000.0,'unixepoch')
        UNION ALL
        SELECT 'CHARACTER_QUEST_REWARD' AS source_key,date(completed_at / 1000.0,'unixepoch') AS day,COUNT(*) AS claims,0 AS coins FROM user_character_quests WHERE is_completed=1 AND completed_at >= ${since} AND completed_at <= ${generatedAt} GROUP BY date(completed_at / 1000.0,'unixepoch')
        UNION ALL
        SELECT source_key,date(created_at / 1000.0,'unixepoch') AS day,0 AS claims,SUM(amount) AS coins FROM coin_transactions WHERE amount>0 AND source_key IN ('CHECKIN_REWARD','MISSION_REWARD','CHARACTER_QUEST_REWARD') AND created_at >= ${since} AND created_at <= ${generatedAt} GROUP BY source_key,date(created_at / 1000.0,'unixepoch')
      ) GROUP BY source_key,day ORDER BY day ASC,source_key ASC
    `;
    const totals=new Map<string,{claims:number;coins:number}>(),daily=new Map<string,{claims:number;coins:number}>();
    for(const source of SOURCES)totals.set(source.key,{claims:0,coins:0});
    for(const row of rows){
      const claims=Number(row.claims),coins=Number(row.coins),source=totals.get(row.source_key);
      if(!source)continue;
      source.claims+=claims;source.coins+=coins;
      const day=daily.get(row.day)??{claims:0,coins:0};day.claims+=claims;day.coins+=coins;daily.set(row.day,day);
    }
    const sources=SOURCES.map(({key,label})=>({key,label,...totals.get(key)!}));
    return {generatedAt:generatedAt.toISOString(),since:since.toISOString(),days,budgetLimitConfigured:false,totalClaims:sources.reduce((sum,row)=>sum+row.claims,0),totalCoins:sources.reduce((sum,row)=>sum+row.coins,0),sources,daily:[...daily].map(([date,value])=>({date,...value}))};
  });
}
