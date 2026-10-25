import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

test('membership reminder pagination advances past replayed events and deferred reminders revalidate',async t=>{
  const fixture=await createFixture();
  t.after(()=>fixture.cleanup());
  const {notificationId}=await import('@rumiai/backend/modules/notifications/identity');
  const {createNotification}=await import('@rumiai/backend/modules/notifications/write');
  const {runMembershipReminders}=await import('@rumiai/backend/modules/notifications/scheduler');
  const {saveNotificationPreferences}=await import('@rumiai/backend/modules/notifications/preferences-service');
  const {listNotifications,countUnread}=await import('@rumiai/backend/modules/notifications/service');
  const {clearCache}=await import('@rumiai/backend/modules/settings/cache');
  for (const [key,value] of Object.entries({
    'notifications.membershipReminderEnabled':true,
    'notifications.membershipReminderHours':24,
  })) await fixture.db.operationSetting.upsert({
    where:{key},create:{key,group:'growth',value:JSON.stringify(value),updatedBy:fixture.admin.id},
    update:{value:JSON.stringify(value)},
  });
  clearCache();
  const now=new Date();
  const expiresAt=new Date(now.getTime()+12*3600000);
  const plan=await fixture.db.membershipPlan.findUniqueOrThrow({where:{code:'MONTHLY'}});
  const owners=Array.from({length:105},(_,index)=>({
    id:'reminder-owner-'+String(index).padStart(3,'0'),
    username:'reminder-owner-'+index,email:'reminder-'+index+'@example.test',passwordHash:'isolated-test-only',
  }));
  await fixture.db.user.createMany({data:owners});
  const orders=owners.map((owner,index)=>({
    id:'reminder-order-'+String(index).padStart(3,'0'),userId:owner.id,orderNo:'REMINDER-'+index,
    idempotencyKey:'reminder-'+index,planId:plan.id,planNameSnapshot:'下单会员',
    amountCents:100,durationDays:30,refundWindowHours:24,usageChargePeriodHours:24,benefitsJson:'[]',status:'PAID',paidAt:now,
  }));
  await fixture.db.membershipOrder.createMany({data:orders});
  const grants=orders.map((order,index)=>({
    id:'reminder-grant-'+String(index).padStart(3,'0'),orderId:order.id,userId:order.userId,
    startsAt:new Date(now.getTime()-3600000),expiresAt,benefitsJson:'[]',status:'ACTIVE',
  }));
  await fixture.db.membershipGrant.createMany({data:grants});
  // All first-page events already exist: the last five must still be visited.
  await fixture.db.notification.createMany({data:grants.slice(0,100).map(grant=>({
    id:notificationId(grant.userId,'MEMBERSHIP_EXPIRY',grant.id+':'+expiresAt.toISOString()),
    userId:grant.userId,type:'MEMBERSHIP_EXPIRY',title:'已有提醒',targetId:grant.orderId,
  }))});
  assert.equal((await runMembershipReminders(now)).created,5);
  assert.equal(await fixture.db.notification.count({where:{type:'MEMBERSHIP_EXPIRY'}}),105);
  assert.equal((await runMembershipReminders(now)).created,0,'replaying all pages preserves event identity');

  const extra=await Promise.all(['renewed','refunded','changed','valid'].map(name=>fixture.db.user.create({
    data:{username:'queued-'+name,email:'queued-'+name+'@example.test',passwordHash:'isolated-test-only'},
  })));
  async function grantFor(userId:string,suffix:string,end=expiresAt){
    const order=await fixture.db.membershipOrder.create({data:{
      userId,orderNo:'QUEUED-'+suffix,idempotencyKey:'queued-'+suffix,planId:plan.id,planNameSnapshot:'延期提醒会员',
      amountCents:100,durationDays:30,refundWindowHours:24,usageChargePeriodHours:24,
      benefitsJson:'[]',status:'PAID',paidAt:now,
    }});
    return fixture.db.membershipGrant.create({data:{orderId:order.id,userId,startsAt:new Date(now.getTime()-3600000),expiresAt:end,benefitsJson:'[]'}});
  }
  const minute=new Date().getUTCHours()*60+new Date().getUTCMinutes();
  async function queue(userId:string,suffix:string){
    const grant=await grantFor(userId,suffix);
    await saveNotificationPreferences(userId,{timezone:'UTC',quietEnabled:true,quietStartMinute:minute,quietEndMinute:(minute+60)%1440});
    const event=await createNotification({
      userId,type:'MEMBERSHIP_EXPIRY',eventKey:grant.id+':'+grant.expiresAt.toISOString(),
      title:'延期会员提醒',targetId:grant.orderId,
    });
    assert.equal((await fixture.db.notification.findUniqueOrThrow({where:{id:event.id}})).deliveryState,'DEFERRED');
    return {grant,event};
  }

  const renewed=await queue(extra[0].id,'renewed-old');
  await grantFor(extra[0].id,'renewed-next',new Date(now.getTime()+30*86400000));
  await fixture.db.notification.update({where:{id:renewed.event.id},data:{availableAt:new Date(Date.now()-1000)}});
  assert.equal((await listNotifications(extra[0].id)).items.length,0,'natural quiet-hour release must not send an obsolete pre-renewal deadline');
  assert.equal(await countUnread(extra[0].id),0);
  assert.equal((await fixture.db.notification.findUniqueOrThrow({where:{id:renewed.event.id}})).deliveryState,'SUPPRESSED');

  const refunded=await queue(extra[1].id,'refunded');
  await fixture.db.membershipOrder.update({where:{id:refunded.grant.orderId},data:{status:'REFUNDED'}});
  await fixture.db.membershipGrant.update({where:{id:refunded.grant.id},data:{status:'REVOKED',revokedAt:new Date()}});
  await saveNotificationPreferences(extra[1].id,{quietEnabled:false});
  assert.equal((await listNotifications(extra[1].id)).items.length,0,'early quiet-hour release rechecks refunded/revoked grants');
  assert.equal((await fixture.db.notification.findUniqueOrThrow({where:{id:refunded.event.id}})).deliveryState,'SUPPRESSED');

  const changed=await queue(extra[2].id,'changed');
  await fixture.db.membershipGrant.update({where:{id:changed.grant.id},data:{expiresAt:new Date(expiresAt.getTime()+3600000)}});
  await saveNotificationPreferences(extra[2].id,{quietEnabled:false});
  assert.equal((await listNotifications(extra[2].id)).items.length,0,'event identity must still match the current grant deadline');

  const valid=await queue(extra[3].id,'valid');
  const reply=await createNotification({userId:extra[3].id,type:'REPLY',eventKey:'queued-unrelated-reply',title:'其他分类通知'});
  await saveNotificationPreferences(extra[3].id,{quietEnabled:false});
  const released=await listNotifications(extra[3].id);
  assert.equal(released.unreadCount,2);
  assert.deepEqual(new Set(released.items.map(item=>item.id)),new Set([valid.event.id,reply.id]));
  assert.equal((await fixture.db.notification.findUniqueOrThrow({where:{id:valid.event.id}})).deliveryState,'DELIVERED');
  assert.equal((await fixture.db.notification.findUniqueOrThrow({where:{id:reply.id}})).deliveryState,'DELIVERED','unrelated event types remain deliverable');
  const replay=await createNotification({userId:extra[3].id,type:'MEMBERSHIP_EXPIRY',eventKey:valid.grant.id+':'+valid.grant.expiresAt.toISOString(),title:'重放',targetId:valid.grant.orderId});
  assert.equal(replay.created,false);
});
