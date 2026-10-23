import {randomUUID} from 'node:crypto';
import {db,pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {logWarning} from '@rumiai/backend/infrastructure/logging/logger';

const recordedToday=new Set<string>();
let lastPrunedDay='';
let storageWarningLogged=false;

function utcDayStart(at:Date){return new Date(Date.UTC(at.getUTCFullYear(),at.getUTCMonth(),at.getUTCDate()));}

/** Record only the first authenticated activity for a user on each UTC date. */
export async function recordUserActivityDay(userId:string,at=new Date()){
  const activityDate=utcDayStart(at),key=`${userId}:${activityDate.toISOString().slice(0,10)}`;
  if(recordedToday.has(key))return;
  await pragmasReady;
  await db.$executeRaw`INSERT OR IGNORE INTO user_activity_days (id,user_id,activity_date) VALUES (${randomUUID()},${userId},${activityDate})`;
  recordedToday.add(key);
  if(recordedToday.size>50_000)recordedToday.clear();

  const dayKey=activityDate.toISOString().slice(0,10);
  if(lastPrunedDay!==dayKey){
    const retentionFloor=new Date(activityDate.getTime()-400*86400000);
    try{await db.userActivityDay.deleteMany({where:{activityDate:{lt:retentionFloor}}});lastPrunedDay=dayKey;}
    catch{if(!storageWarningLogged){storageWarningLogged=true;logWarning('analytics_activity_prune_failed');}}
  }
}

export function logActivityStorageUnavailable(){
  if(storageWarningLogged)return;
  storageWarningLogged=true;
  logWarning('analytics_activity_record_failed');
}
