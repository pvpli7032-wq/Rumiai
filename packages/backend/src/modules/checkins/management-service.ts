import type {Prisma} from '@prisma/client';
import {db,pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {hasAdminPermission} from '@rumiai/backend/modules/admin/authorization';
import {recordAdminAudit} from '@rumiai/backend/modules/admin/management-service';

export class CheckinManagementError extends Error{
  constructor(message:string,public status=400){super(message);this.name='CheckinManagementError';}
}

async function requireGrowth(actor:string,permission:'growth.read'|'growth.manage',tx?:Prisma.TransactionClient){
  if(!await hasAdminPermission(actor,permission,tx))throw new CheckinManagementError('当前账号没有签到奖励管理权限。',403);
}

export async function readCheckinRules(actor:string){
  await pragmasReady;
  return db.$transaction(async tx=>{
    await requireGrowth(actor,'growth.read',tx);
    const rules=await tx.checkinRewardRule.findMany({orderBy:{streakDay:'asc'}});
    return {rules};
  });
}

export async function saveCheckinRules(actor:string,input:unknown){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new CheckinManagementError('签到奖励数据格式错误。');
  const body=input as Record<string,unknown>;
  if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.trim().length>500)throw new CheckinManagementError('请填写 1–500 字操作理由。');
  if(!Array.isArray(body.rules)||body.rules.length!==7)throw new CheckinManagementError('必须完整提交第 1–7 天奖励配置。');
  const rules=body.rules.map(raw=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new CheckinManagementError('奖励档位格式错误。');
    const row=raw as Record<string,unknown>;
    if(!Number.isSafeInteger(row.streakDay)||Number(row.streakDay)<1||Number(row.streakDay)>7||!Number.isSafeInteger(row.rewardCoins)||Number(row.rewardCoins)<0||Number(row.rewardCoins)>10000||!Number.isSafeInteger(row.version)||Number(row.version)<0)throw new CheckinManagementError('签到奖励档位数值无效。');
    return {streakDay:Number(row.streakDay),rewardCoins:Number(row.rewardCoins),version:Number(row.version)};
  });
  if(new Set(rules.map(row=>row.streakDay)).size!==7)throw new CheckinManagementError('签到奖励日期重复或缺失。');
  const reason=body.reason.trim();
  await pragmasReady;
  return db.$transaction(async tx=>{
    await tx.$executeRaw`UPDATE admin_operators SET version = version WHERE user_id = ${actor}`;
    await requireGrowth(actor,'growth.manage',tx);
    for(const row of rules){
      const updated=await tx.checkinRewardRule.updateMany({where:{streakDay:row.streakDay,version:row.version},data:{rewardCoins:row.rewardCoins,updatedBy:actor,version:{increment:1}}});
      if(!updated.count)throw new CheckinManagementError('签到奖励已被其他操作修改，请刷新后重试。',409);
    }
    await recordAdminAudit(tx,actor,'UPDATE_CHECKIN_REWARDS','checkin-reward-rules',reason,{rules:rules.map(({streakDay,rewardCoins})=>({streakDay,rewardCoins}))});
    return {saved:true};
  });
}
