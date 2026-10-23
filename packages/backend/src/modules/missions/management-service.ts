import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {db,pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {hasAdminPermission} from '@rumiai/backend/modules/admin/authorization';
import {claimWriter, recordAdminAudit} from '@rumiai/backend/modules/admin/management-service';

export const MISSION_CONDITIONS=['CHECKIN_COUNT','MESSAGE_COUNT','POST_COUNT','COMMENT_COUNT','MANUAL'] as const;
export const MISSION_PERIODS=['ONCE','DAILY','WEEKLY'] as const;
export const MISSION_CATEGORIES=['DAILY','ONBOARDING','STARTER','SPECIAL','CREATOR'] as const;
export type MissionCondition=typeof MISSION_CONDITIONS[number];
export type MissionPeriod=typeof MISSION_PERIODS[number];

export class MissionManagementError extends Error{
  constructor(message:string,public status=400){super(message);this.name='MissionManagementError';}
}

function object(input:unknown):Record<string,unknown>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new MissionManagementError('任务数据格式错误。');
  return input as Record<string,unknown>;
}
function optionalDate(value:unknown,name:string){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value!=='string'||value.length>40)throw new MissionManagementError(`${name}格式无效。`);
  const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new MissionManagementError(`${name}格式无效。`);
  return date;
}
async function requirePermission(actor:string,permission:'growth.read'|'growth.manage',tx?:Prisma.TransactionClient){
  if(!await hasAdminPermission(actor,permission,tx))throw new MissionManagementError('当前账号没有任务与奖励管理权限。',403);
}
export async function readManagedMissions(actor:string){
  await pragmasReady;
  return db.$transaction(async tx=>{
    await requirePermission(actor,'growth.read',tx);
    const missions=await tx.mission.findMany({orderBy:[{sortOrder:'asc'},{createdAt:'desc'},{id:'asc'}],take:200});
    return {missions};
  });
}

export async function saveManagedMission(actor:string,input:unknown){
  const body=object(input);
  const title=typeof body.title==='string'?body.title.trim():'';
  if(!title||title.length>100)throw new MissionManagementError('任务名称须为 1–100 字。');
  const description=body.description===null||body.description===undefined?'':typeof body.description==='string'?body.description.trim():null;
  if(description===null||description.length>1000)throw new MissionManagementError('任务说明最多 1000 字。');
  if(typeof body.category!=='string'||!MISSION_CATEGORIES.includes(body.category as typeof MISSION_CATEGORIES[number]))throw new MissionManagementError('任务分类无效。');
  if(typeof body.conditionType!=='string'||!MISSION_CONDITIONS.includes(body.conditionType as MissionCondition))throw new MissionManagementError('任务条件无效。');
  if(typeof body.period!=='string'||!MISSION_PERIODS.includes(body.period as MissionPeriod))throw new MissionManagementError('任务周期无效。');
  if(!Number.isSafeInteger(body.conditionTarget)||Number(body.conditionTarget)<1||Number(body.conditionTarget)>10000)throw new MissionManagementError('任务目标须为 1–10000。');
  if(!Number.isSafeInteger(body.rewardCoins)||Number(body.rewardCoins)<0||Number(body.rewardCoins)>10000)throw new MissionManagementError('奖励金币须为 0–10000。');
  if(!Number.isSafeInteger(body.sortOrder)||Number(body.sortOrder)<0||Number(body.sortOrder)>100000)throw new MissionManagementError('排序值无效。');
  if(typeof body.isActive!=='boolean')throw new MissionManagementError('任务启用状态无效。');
  if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.trim().length>500)throw new MissionManagementError('请填写 1–500 字操作理由。');
  const isActive=body.isActive,reason=body.reason.trim();
  if(body.isActive&&body.conditionType==='MANUAL')throw new MissionManagementError('手动核验任务暂不能发放金币，请选择可自动核验的条件。');
  const startsAt=optionalDate(body.startsAt,'开始时间'),endsAt=optionalDate(body.endsAt,'结束时间');
  if(startsAt&&endsAt&&startsAt.getTime()>=endsAt.getTime())throw new MissionManagementError('结束时间必须晚于开始时间。');
  const id=body.id;
  if(id!==undefined&&(typeof id!=='string'||!/^[-A-Za-z0-9_]{1,100}$/.test(id)))throw new MissionManagementError('任务编号无效。');
  if(id&&(!Number.isSafeInteger(body.version)||Number(body.version)<0))throw new MissionManagementError('任务版本无效，请刷新后重试。');
  await pragmasReady;
  return db.$transaction(async tx=>{
    await claimWriter(tx,actor);await requirePermission(actor,'growth.manage',tx);
    const before=id?await tx.mission.findUnique({where:{id}}):null;
    if(id&&!before)throw new MissionManagementError('任务不存在。',404);
    if(before&&before.version!==body.version)throw new MissionManagementError('任务已被其他操作修改，请刷新。',409);
    const values={
      title,description:description||null,rewardCoins:Number(body.rewardCoins),category:String(body.category),
      conditionType:String(body.conditionType),conditionTarget:Number(body.conditionTarget),period:String(body.period),
      isActive:!!isActive,sortOrder:Number(body.sortOrder),startsAt,endsAt,
    };
    const saved=before
      ? await tx.mission.update({where:{id:before.id},data:{...values,version:{increment:1}}})
      : await tx.mission.create({data:{id:randomUUID().replaceAll('-',''),...values,version:1}});
    await recordAdminAudit(tx,actor,before?'UPDATE_GROWTH_MISSION':'CREATE_GROWTH_MISSION',saved.id,reason,{
      before:before?{title:before.title,rewardCoins:before.rewardCoins,conditionType:before.conditionType,conditionTarget:before.conditionTarget,period:before.period,isActive:before.isActive,version:before.version}:null,
      after:{title:saved.title,rewardCoins:saved.rewardCoins,conditionType:saved.conditionType,conditionTarget:saved.conditionTarget,period:saved.period,isActive:saved.isActive,version:saved.version},
    });
    return saved;
  });
}
