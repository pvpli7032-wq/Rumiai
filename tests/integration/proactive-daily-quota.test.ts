import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixture} from '../helpers/sqlite-fixture.mjs';
test('proactive daily attempts are reserved atomically without consuming chat slots',async t=>{
 const fixture=await createFixture();t.after(()=>fixture.cleanup());
 for(const [key,value] of [['proactive.maxPerUserDaily',1],['billing.dayTimezone','Asia/Taipei']] as const)await fixture.db.operationSetting.upsert({where:{key},create:{key,group:key.startsWith('billing.')?'billing':'growth',updatedBy:fixture.admin.id,value:JSON.stringify(value)},update:{value:JSON.stringify(value)}});
 const {reserveAiCall,AiQuotaError}=await import('@rumiai/backend/modules/ai/ai-usage');
 const {resolveZonedDayRange}=await import('@rumiai/backend/infrastructure/time/zoned-day');
 const character=await fixture.db.character.create({data:{name:'额度测试角色',personality:'test',background:'test',creatorId:fixture.user.id}});
 const conversation=await fixture.db.conversation.create({data:{userId:fixture.user.id,characterId:character.id}});
 const {startAt}=resolveZonedDayRange(new Date(),'Asia/Taipei');
 await fixture.db.aiCall.create({data:{userId:fixture.user.id,conversationId:conversation.id,operation:'PROACTIVE_GREETING',currency:'USD',status:'FAILED',startedAt:new Date(startAt.getTime()-1)}});
 const results=await Promise.allSettled([reserveAiCall(fixture.user.id,conversation.id,'PROACTIVE_GREETING'),reserveAiCall(fixture.user.id,conversation.id,'PROACTIVE_GREETING')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const rejected=results.find(r=>r.status==='rejected');assert.ok(rejected&&rejected.status==='rejected'&&rejected.reason instanceof AiQuotaError);
 await fixture.db.aiCall.updateMany({where:{operation:'PROACTIVE_GREETING'},data:{status:'FAILED'}});
 await assert.rejects(()=>reserveAiCall(fixture.user.id,conversation.id,'PROACTIVE_GREETING'),AiQuotaError);
 assert.equal(await fixture.db.aiDailyUsage.count(),0);
});
