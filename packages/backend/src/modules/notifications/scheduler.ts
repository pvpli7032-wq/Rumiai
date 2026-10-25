import type {Prisma} from '@prisma/client';
import {db} from '@rumiai/backend/infrastructure/database/client';
import {readSettingValue} from '@rumiai/backend/modules/settings';
import {createNotification} from './write';
import {runProactiveGreetings} from './proactive-service';

/** Keyset pagination advances even when all events on a page already exist. */
export async function runMembershipReminders(now=new Date()) {
  const [enabled,hours]=await Promise.all([
    readSettingValue<boolean>('notifications.membershipReminderEnabled'),
    readSettingValue<number|null>('notifications.membershipReminderHours'),
  ]);
  if (!enabled || !hours || hours<=0) return {created:0,reason:'DISABLED_OR_UNCONFIGURED'};
  const deadline=new Date(now.getTime()+hours*3600000);
  let after:{expiresAt:Date;id:string}|null=null;
  let created=0;
  for (;;) {
    const where:Prisma.MembershipGrantWhereInput={
      status:'ACTIVE',revokedAt:null,expiresAt:{gt:now,lte:deadline},
      ...(after?{OR:[{expiresAt:{gt:after.expiresAt}},{expiresAt:after.expiresAt,id:{gt:after.id}}]}:{}),
    };
    const grants=await db.membershipGrant.findMany({
      where,orderBy:[{expiresAt:'asc'},{id:'asc'}],take:100,
      include:{order:{select:{id:true,status:true,planNameSnapshot:true,refund:{select:{status:true}},plan:{select:{name:true}}}}},
    });
    if (!grants.length) break;
    for (const grant of grants) {
      if (grant.order.status!=='PAID' || grant.order.refund && grant.order.refund.status!=='FAILED') continue;
      const later=await db.membershipGrant.findFirst({
        where:{
          userId:grant.userId,status:'ACTIVE',revokedAt:null,expiresAt:{gt:grant.expiresAt},
          order:{status:'PAID',OR:[{refund:{is:null}},{refund:{is:{status:'FAILED'}}}]},
        },
        select:{id:true},
      });
      if (later) continue;
      const event=await createNotification({
        userId:grant.userId,type:'MEMBERSHIP_EXPIRY',
        eventKey:grant.id+':'+grant.expiresAt.toISOString(),
        title:'会员权益即将到期',
        body:(grant.order.planNameSnapshot??grant.order.plan.name)+' 将于 '+grant.expiresAt.toISOString()+' 到期，可按需手动续费。',
        targetType:null,targetId:grant.order.id,
      });
      if (event.created) created++;
    }
    const last=grants[grants.length-1];
    after={expiresAt:last.expiresAt,id:last.id};
    if (grants.length<100) break;
  }
  return {created};
}

export async function runNotificationSchedule() {
  const membership=await runMembershipReminders();
  const proactive=await runProactiveGreetings();
  return {outcome:'会员提醒 '+membership.created+' 条，主动问候 '+proactive.sent+' 条，跳过 '+proactive.skipped+' 条'};
}
