import test from 'node:test';
import assert from 'node:assert/strict';

test('growth module controls and AI cost tiers preserve history and audit decisions',async t=>{
  assert.equal(process.env.DATABASE_URL,undefined,'fixture must own its database');
  const {createFixture}=await import('../helpers/sqlite-fixture.mjs');
  const fixture=await createFixture();t.after(()=>fixture.cleanup());
  const {readGrowthModules,saveGrowthModule}=await import('@rumiai/backend/modules/growth/modules/state-service');
  const {readUserMissions,claimMissionReward}=await import('@rumiai/backend/modules/missions/reward-service');
  const {readCheckinStatus,claimDailyCheckin}=await import('@rumiai/backend/modules/checkins/service');
  const {sendCatalogGift}=await import('@rumiai/backend/modules/gifts/send-service');
  const before=await readGrowthModules(fixture.admin.id);
  assert.deepEqual(before.modules.map(item=>item.id),['missions','checkin','gifts']);
  assert.ok(before.modules.every(item=>item.isEnabled));
  await assert.rejects(()=>saveGrowthModule(fixture.admin.id,{moduleId:'missions',isEnabled:false,config:{unknown:true},version:0,reason:'invalid config'}),/未声明字段/);
  for(const moduleId of ['missions','checkin','gifts'] as const)await saveGrowthModule(fixture.admin.id,{moduleId,isEnabled:false,config:{},version:0,reason:`disable ${moduleId} in isolated test`});
  assert.deepEqual(await readUserMissions(fixture.user.id),[]);
  await assert.rejects(()=>claimMissionReward(fixture.user.id,'missing'),error=>(error as {status?:number}).status===409&&/停用/.test(String(error)));
  await assert.rejects(()=>readCheckinStatus(fixture.user.id),error=>(error as {status?:number}).status===409&&/停用/.test(String(error)));
  await assert.rejects(()=>claimDailyCheckin(fixture.user.id),error=>(error as {status?:number}).status===409&&/停用/.test(String(error)));
  const character=await fixture.db.character.create({data:{name:'growth-module-character',personality:'test',background:'test',creatorId:fixture.user.id,isPublic:true,reviewStatus:'APPROVED'}});
  const gift=await fixture.db.giftCatalogItem.create({data:{code:'growth_test',name:'Growth test',emoji:'🎁',coinPrice:1,isActive:true}});
  const historyBefore=await fixture.db.gift.count();
  await assert.rejects(()=>sendCatalogGift(fixture.user.id,character.id,{giftId:gift.id}),error=>(error as {status?:number}).status===409&&/停用/.test(String(error)));
  assert.equal(await fixture.db.gift.count(),historyBefore);
  assert.equal((await fixture.db.adminAuditLog.findMany({where:{action:'SAVE_GROWTH_MODULE'}})).length,3);

  const {saveAiModelPrice,readAiModelPriceSettings,estimateAiCostFromTieredPrice}=await import('@rumiai/backend/modules/ai/costs/model-price-service');
  const {finishAiCall}=await import('@rumiai/backend/modules/ai/ai-usage');
  const provider=await fixture.db.aiProvider.create({data:{name:'tier-provider',baseUrl:'https://tier.example.test/v1',isActive:true}});
  const model=await fixture.db.aiModel.create({data:{key:'tier-model',displayName:'Tier model',modelCode:'tier-model-v1',providerId:provider.id,isActive:true}});
  const effectiveAt=new Date(Date.now()-60_000).toISOString();
  const tiers=[
    {minInputTokens:0,maxInputTokens:100,inputPricePerMillion:'1',outputPricePerMillion:'2',cachedInputPricePerMillion:'0.5'},
    {minInputTokens:100,maxInputTokens:null,inputPricePerMillion:'3',outputPricePerMillion:'4',cachedInputPricePerMillion:null},
  ];
  await assert.rejects(()=>saveAiModelPrice(fixture.admin.id,{modelId:model.id,currency:'USD',inputPricePerMillion:'1',outputPricePerMillion:'2',effectiveAt,source:'isolated test',reason:'gap validation',tiers:[{...tiers[0],maxInputTokens:90},tiers[1]]}),/连续/);
  const saved=await saveAiModelPrice(fixture.admin.id,{modelId:model.id,currency:'USD',inputPricePerMillion:'1',outputPricePerMillion:'2',effectiveAt,source:'isolated test',reason:'tier calculation test',tiers});
  assert.equal(saved.tiers.length,2);
  const settings=await readAiModelPriceSettings(fixture.admin.id),price=settings.models.find(item=>item.id===model.id)!.prices[0];
  assert.deepEqual(price.tiers.map(item=>[item.minInputTokens,item.maxInputTokens]),[[0,100],[100,null]]);
  const row=await fixture.db.aiModelPrice.findUniqueOrThrow({where:{id:saved.id},include:{tiers:{orderBy:{sortOrder:'asc'}}}});
  const low=estimateAiCostFromTieredPrice(99,10,20,row),boundary=estimateAiCostFromTieredPrice(100,10,0,row);
  assert.equal(low?.tierId,row.tiers[0].id);assert.equal(boundary?.tierId,row.tiers[1].id);
  assert.equal(low?.amount,0.000109);assert.equal(boundary?.amount,0.00034);
  assert.equal(estimateAiCostFromTieredPrice(10,1,11,row),null);
  const startedAt=new Date(),call=await fixture.db.aiCall.create({data:{userId:fixture.user.id,operation:'SEND',currency:'USD',startedAt}});
  await finishAiCall(call.id,startedAt,'SUCCEEDED',{modelKey:model.key,model:model.modelCode,inputTokens:100,outputTokens:10,cachedInputTokens:0});
  const finished=await fixture.db.aiCall.findUniqueOrThrow({where:{id:call.id}});
  assert.equal(finished.modelPriceTierId,row.tiers[1].id);assert.equal(finished.estimatedCost,0.00034);
  assert.deepEqual(JSON.parse(finished.costAuditJson!),{version:1,priceId:row.id,tierId:row.tiers[1].id,minInputTokens:100,maxInputTokens:null,inputTokens:100,outputTokens:10,cachedInputTokens:0,inputPricePerMillion:'3',outputPricePerMillion:'4',cachedInputPricePerMillion:'3'});
});
