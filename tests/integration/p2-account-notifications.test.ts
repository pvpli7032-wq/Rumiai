import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

test('P2 account preferences, ledger, notifications and member snapshots use real isolated storage',async t=>{
 const fixture=await createFixture();t.after(()=>fixture.cleanup());
 const {updateOwnProfile,readOwnProfile}=await import('@rumiai/backend/modules/accounts/profile-service');
 await updateOwnProfile(fixture.user.id,{readerPreferences:{fontSize:'larger',lineSpacing:'relaxed',bubbleStyle:'plain',streamDisplayMode:'complete',sendKey:'modifier-enter',speechRate:1.25},shortcuts:JSON.stringify([{label:'第一句',text:'你好'}])});
 const user=await readOwnProfile(fixture.user.id);assert.equal(user.readerPreferences.fontSize,'larger');assert.equal(user.readerPreferences.streamDisplayMode,'complete');assert.equal(user.readerPreferences.sendKey,'modifier-enter');
 await assert.rejects(()=>updateOwnProfile(fixture.user.id,{readerPreferences:{fontSize:'impossible'}}));
 await assert.rejects(()=>updateOwnProfile(fixture.user.id,{shortcuts:JSON.stringify([{label:'',text:'无效'}])}));
 const {readCoinLedger}=await import('@rumiai/backend/modules/coins/ledger-service');
 const when=new Date('2026-01-02T10:00:00Z');const entries=await Promise.all([fixture.db.coinTransaction.create({data:{userId:fixture.user.id,type:'EARNED',amount:5,sourceKey:'P2_TEST_IN',createdAt:when}}),fixture.db.coinTransaction.create({data:{userId:fixture.user.id,type:'SPENT',amount:-2,sourceKey:'P2_TEST_OUT',createdAt:when}}),fixture.db.coinTransaction.create({data:{userId:fixture.admin.id,type:'EARNED',amount:9,sourceKey:'P2_TEST_IN',createdAt:when}})]);
 const incoming=await readCoinLedger(fixture.user.id,{direction:'in',source:'P2_TEST_IN',from:'2026-01-02',to:'2026-01-02'});assert.deepEqual(incoming.items.map(row=>row.id),[entries[0].id]);
 const outgoing=await readCoinLedger(fixture.user.id,{direction:'out'});assert.ok(outgoing.items.every(row=>row.amount<0));
 await assert.rejects(()=>readCoinLedger(fixture.user.id,{cursor:entries[2].id}),/游标/);await assert.rejects(()=>readCoinLedger(fixture.user.id,{from:'2026-02-30'}),/日期/);
 const {saveNotificationPreferences,readNotificationPreferences,nextOutsideQuiet}=await import('@rumiai/backend/modules/notifications/preferences-service');
 const {createNotification}=await import('@rumiai/backend/modules/notifications/write');const {countUnread,listNotifications,markAllNotificationsRead}=await import('@rumiai/backend/modules/notifications/service');
 await fixture.db.notification.deleteMany({where:{userId:fixture.user.id}});
 await saveNotificationPreferences(fixture.user.id,{categories:{replies:false},timezone:'Asia/Shanghai',quietEnabled:false});
 await createNotification({userId:fixture.user.id,type:'REPLY',eventKey:'p2-muted-reply',title:'不会投递'});assert.equal(await countUnread(fixture.user.id),0);assert.equal((await listNotifications(fixture.user.id)).items.length,0);
 const suppressed=await fixture.db.notification.findFirstOrThrow({where:{userId:fixture.user.id,type:'REPLY'}});assert.equal(suppressed.deliveryState,'SUPPRESSED');
 await saveNotificationPreferences(fixture.user.id,{categories:{replies:true}});await createNotification({userId:fixture.user.id,type:'REPLY',eventKey:'p2-muted-reply',title:'重放不复活'});assert.equal(await countUnread(fixture.user.id),0);
 await createNotification({userId:fixture.user.id,type:'REPLY',eventKey:'p2-visible-reply',title:'正常提醒',targetType:'CONVERSATION',targetId:'missing-p2-target'});const page=await listNotifications(fixture.user.id);assert.equal(page.unreadCount,1);assert.equal(page.items[0].href,null);assert.ok(page.items[0].targetUnavailableReason);await markAllNotificationsRead(fixture.user.id);assert.equal(await countUnread(fixture.user.id),0);
 const quietMinute=new Date().getUTCHours()*60+new Date().getUTCMinutes();await saveNotificationPreferences(fixture.user.id,{timezone:'UTC',quietEnabled:true,quietStartMinute:quietMinute,quietEndMinute:(quietMinute+120)%1440});await createNotification({userId:fixture.user.id,type:'REPLY',eventKey:'p2-quiet-reply',title:'延迟通知'});const deferred=await fixture.db.notification.findFirstOrThrow({where:{userId:fixture.user.id,title:'延迟通知'}});assert.equal(deferred.deliveryState,'DEFERRED');assert.equal(await countUnread(fixture.user.id),0);await saveNotificationPreferences(fixture.user.id,{timezone:'Asia/Shanghai',quietEnabled:false});assert.equal(await countUnread(fixture.user.id),1,'ending quiet hours releases queued notification');await markAllNotificationsRead(fixture.user.id);
 await assert.rejects(()=>saveNotificationPreferences(fixture.user.id,{timezone:'Not/A_Zone'}),/时区/);await assert.rejects(()=>saveNotificationPreferences(fixture.user.id,{quietEnabled:true,quietStartMinute:30,quietEndMinute:30}),/不能相同/);
 const dst=nextOutsideQuiet(new Date('2026-03-08T06:30:00Z'),'America/New_York',60,240);assert.equal(dst.toISOString(),'2026-03-08T08:00:00.000Z');
 const pref=await readNotificationPreferences(fixture.user.id);assert.equal(pref.timezone,'Asia/Shanghai');assert.equal(pref.categories.proactive,false);
 const {runProactiveGreetings,cancelProactiveSubscription}=await import('@rumiai/backend/modules/notifications/proactive-service');const result=await runProactiveGreetings();assert.equal(result.sent,0,'disabled task must never call a provider');
 await assert.rejects(()=>cancelProactiveSubscription(fixture.user.id,'missing-conversation'),/不存在/);
 const {readMembershipOrderPage}=await import('@rumiai/backend/modules/memberships/service');const plan=await fixture.db.membershipPlan.findUniqueOrThrow({where:{code:'MONTHLY'}});const order=await fixture.db.membershipOrder.create({data:{userId:fixture.user.id,orderNo:'P2-SNAPSHOT',idempotencyKey:'P2-SNAPSHOT',planId:plan.id,planNameSnapshot:'下单时名称',amountCents:100,durationDays:30,refundWindowHours:24,usageChargePeriodHours:24,benefitsJson:'[]'}});await fixture.db.membershipPlan.update({where:{id:plan.id},data:{name:'改名后套餐'}});const orders=await readMembershipOrderPage(fixture.user.id,{limit:'1'});assert.equal(orders.items.find(item=>item.orderNo===order.orderNo)?.planName,'下单时名称');assert.ok(!(await readMembershipOrderPage(fixture.admin.id)).items.some(item=>item.orderNo===order.orderNo));
 // A controlled fetch is the only upstream: concurrent sweeps must claim once,
 // and cancelling while the response is pending must prevent message delivery.
 const previousFetch=globalThis.fetch,previousKey=process.env.AI_PROVIDER_ENCRYPTION_KEY;
 t.after(()=>{globalThis.fetch=previousFetch;if(previousKey===undefined)delete process.env.AI_PROVIDER_ENCRYPTION_KEY;else process.env.AI_PROVIDER_ENCRYPTION_KEY=previousKey;});
 process.env.AI_PROVIDER_ENCRYPTION_KEY='ad'.repeat(32);
 const {encryptProviderSecret}=await import('@rumiai/backend/modules/ai/providers/secret');
 const provider=await fixture.db.aiProvider.create({data:{name:'p2-greeting-fixture',baseUrl:'https://p2-greeting.example.test/v1',isActive:true,...encryptProviderSecret('fixture-not-a-real-key')}});
 await fixture.db.aiModel.create({data:{key:'p2-greeting-model',displayName:'P2 isolated greeting model',modelCode:'fixture',providerId:provider.id,isActive:true,maxRetries:0}});
 for(const [key,value] of Object.entries({'proactive.enabled':true,'proactive.maxSubscriptions':2,'proactive.minIntervalHours':1,'proactive.maxPerUserDaily':5,'proactive.maxMessageChars':200,'ai.taskModel.proactiveGreeting':'p2-greeting-model','budget.task.proactiveGreeting':1,'prompt.proactiveGreeting':'isolated proactive prompt'}))await fixture.db.operationSetting.upsert({where:{key},create:{key,group:'growth',value:JSON.stringify(value),updatedBy:fixture.admin.id},update:{value:JSON.stringify(value)}});
 const {clearCache}=await import('@rumiai/backend/modules/settings/cache');clearCache();
 await saveNotificationPreferences(fixture.user.id,{categories:{proactive:true},quietEnabled:false});
 const character=await fixture.db.character.create({data:{name:'P2 mock role',personality:'fictional isolated character',background:'fixture only',creatorId:fixture.user.id}});
 const conversation=await fixture.db.conversation.create({data:{userId:fixture.user.id,characterId:character.id}});
 const {saveProactiveSubscription}=await import('@rumiai/backend/modules/notifications/proactive-service');
 const currentMinute=new Date().getUTCHours()*60+new Date().getUTCMinutes();
 await saveProactiveSubscription(fixture.user.id,conversation.id,{enabled:true,timezone:'UTC',windowStartMinute:currentMinute,windowEndMinute:(currentMinute+720)%1440,intervalHours:1});
 await assert.rejects(()=>readProactiveSubscriptionForOther(),/不存在/);
 async function readProactiveSubscriptionForOther(){const {readProactiveSubscription}=await import('@rumiai/backend/modules/notifications/proactive-service');return readProactiveSubscription(fixture.admin.id,conversation.id);}
 let calls=0;let release!:()=>void;let started!:()=>void;
 let startedPromise=new Promise<void>(resolve=>{started=resolve;});let gate=new Promise<void>(resolve=>{release=resolve;});
 globalThis.fetch=async(input)=>{assert.equal(String(input),'https://p2-greeting.example.test/v1/chat/completions','test permits no real provider');calls++;started();await gate;return new Response('data: '+JSON.stringify({choices:[{delta:{content:'路过给你留一句问候。'}}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});};
 const due=()=>fixture.db.proactiveSubscription.update({where:{userId_conversationId:{userId:fixture.user.id,conversationId:conversation.id}},data:{nextRunAt:new Date(Date.now()-1000)}});
 await due();const firstRun=runProactiveGreetings();await Promise.race([startedPromise,new Promise((_,reject)=>setTimeout(()=>reject(Error('mock upstream was not reached')),10000).unref())]);
 const concurrent=await runProactiveGreetings();assert.equal(concurrent.sent,0);release();assert.equal((await firstRun).sent,1);assert.equal(calls,1);assert.equal(await fixture.db.message.count({where:{conversationId:conversation.id}}),1);
 assert.equal(await fixture.db.aiDailyUsage.count(),0,'proactive greeting never consumes user chat slots');assert.equal(await fixture.db.generationCharge.count(),0,'proactive greeting never charges user coins');
 startedPromise=new Promise<void>(resolve=>{started=resolve;});gate=new Promise<void>(resolve=>{release=resolve;});await due();const cancelledRun=runProactiveGreetings();await Promise.race([startedPromise,new Promise((_,reject)=>setTimeout(()=>reject(Error('cancel test upstream was not reached')),10000).unref())]);await cancelProactiveSubscription(fixture.user.id,conversation.id);release();await cancelledRun;assert.equal(calls,2);assert.equal(await fixture.db.message.count({where:{conversationId:conversation.id}}),1,'cancellation during generation discards the response');
 const billed=await fixture.db.aiCall.findMany({where:{taskType:'proactive_greeting'}});assert.equal(billed.length,2);assert.ok(billed.every(call=>call.operation==='PROACTIVE_GREETING'));

});
