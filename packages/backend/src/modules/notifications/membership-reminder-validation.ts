import type {Prisma} from '@prisma/client';
import {db} from '@rumiai/backend/infrastructure/database/client';
import {notificationId} from './identity';

/** A queued reminder describes one specific grant deadline, never a later renewal. */
async function reminderStillCurrent(
  reader: Prisma.TransactionClient,
  event: {id:string;userId:string;targetId:string|null},
  now: Date,
): Promise<boolean> {
  if (!event.targetId) return false;
  const grant = await reader.membershipGrant.findFirst({
    where: {orderId:event.targetId,userId:event.userId},
    include: {order:{select:{status:true,refund:{select:{status:true}}}}},
  });
  if (!grant || grant.status !== 'ACTIVE' || grant.revokedAt || grant.expiresAt <= now ||
      grant.order.status !== 'PAID' || grant.order.refund && grant.order.refund.status !== 'FAILED') return false;
  const expectedId = notificationId(event.userId,'MEMBERSHIP_EXPIRY',grant.id+':'+grant.expiresAt.toISOString());
  if (expectedId !== event.id) return false;
  const later = await reader.membershipGrant.findFirst({
    where: {
      userId:event.userId,status:'ACTIVE',revokedAt:null,expiresAt:{gt:grant.expiresAt},
      order:{status:'PAID',OR:[{refund:{is:null}},{refund:{is:{status:'FAILED'}}}]},
    },
    select:{id:true},
  });
  return !later;
}

/** Only queued membership reminders are reconciled. Delivered history and other event types stay intact. */
export async function suppressStaleMembershipReminders(
  userId:string, reader:Prisma.TransactionClient=db, now=new Date(),
):Promise<number> {
  const events = await reader.notification.findMany({
    where:{userId,type:'MEMBERSHIP_EXPIRY',deliveryState:'DEFERRED'},
    select:{id:true,userId:true,targetId:true},
  });
  let suppressed=0;
  for (const event of events) {
    if (await reminderStillCurrent(reader,event,now)) continue;
    const changed=await reader.notification.updateMany({
      where:{id:event.id,userId,type:'MEMBERSHIP_EXPIRY',deliveryState:'DEFERRED'},
      data:{deliveryState:'SUPPRESSED',availableAt:null},
    });
    suppressed+=changed.count;
  }
  return suppressed;
}
