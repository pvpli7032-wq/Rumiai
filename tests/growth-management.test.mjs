import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file=`growth-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL=`file:./${file}`;process.env.JWT_SECRET=randomUUID()+randomUUID();
process.env.PAYMENT_ADMIN_USER_IDS='';process.env.MODERATOR_USER_IDS='';delete process.env.RUST_LOG;
const env={...process.env};delete env.RUST_LOG;
const migration=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});
assert.equal(migration.status,0,migration.stdout+migration.stderr);
const {db}=await import('../src/lib/db.ts');
const {signToken}=await import('../src/lib/auth.ts');
const {bootstrapOwner,saveOperator}=await import('../src/lib/admin/management-service.ts');
const {GET:readMissions,POST:createMission}=await import('../src/app/api/admin/growth/missions/route.ts');
const {PATCH:updateMission}=await import('../src/app/api/admin/growth/missions/[id]/route.ts');
const {GET:readCheckinRules,PUT:saveCheckinRules}=await import('../src/app/api/admin/growth/checkins/route.ts');
const {GET:publicMissions}=await import('../src/app/api/missions/route.ts');
const {POST:claimMission}=await import('../src/app/api/missions/[id]/complete/route.ts');
const {GET:checkinStatus,POST:doCheckin}=await import('../src/app/api/checkin/route.ts');
const {POST:claimCharacterQuest}=await import('../src/app/api/characters/[id]/quests/[questId]/complete/route.ts');
const {POST:sendGift}=await import('../src/app/api/characters/[id]/gift/route.ts');
const {GET:readGiftCatalog,POST:createGift}=await import('../src/app/api/admin/growth/gifts/route.ts');
const {PATCH:updateGift}=await import('../src/app/api/admin/growth/gifts/[id]/route.ts');
const {GET:publicGiftCatalog}=await import('../src/app/api/gifts/route.ts');
const {GET:readRewardReport}=await import('../src/app/api/admin/growth/rewards/route.ts');
const {GET:readCharacterQuests,POST:createCharacterQuest}=await import('../src/app/api/characters/[id]/quests/route.ts');
const owner=await db.user.create({data:{username:'growth_owner_'+process.pid,email:'growth-owner-'+process.pid+'@example.invalid',passwordHash:'synthetic'}});
const manager=await db.user.create({data:{username:'growth_manager_'+process.pid,email:'growth-manager-'+process.pid+'@example.invalid',passwordHash:'synthetic'}});
const reader=await db.user.create({data:{username:'growth_reader_'+process.pid,email:'growth-reader-'+process.pid+'@example.invalid',passwordHash:'synthetic'}});
await bootstrapOwner(owner.email);
const role=await db.adminRole.findUniqueOrThrow({where:{code:'GROWTH_MANAGER'}});
await saveOperator(owner.id,{userId:manager.id,enabled:true,version:0,roleIds:[role.id],reason:'隔离任务管理测试'});
const token=user=>signToken({userId:user.id,email:user.email,tokenVersion:user.tokenVersion});
const request=async(user,url,method='GET',body)=>new Request('http://localhost'+url,{method,headers:{...(user?{Authorization:'Bearer '+await token(user)}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
test.after(async()=>{await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])rmSync(path.resolve('prisma',file+suffix),{force:true});});

test('growth missions verify server activity, schedule one-time claims and persist audited check-in rewards',async()=>{
  assert.equal((await readMissions(await request(reader,'/api/admin/growth/missions'))).status,403);
  const rulesResponse=await readCheckinRules(await request(manager,'/api/admin/growth/checkins'));
  assert.equal(rulesResponse.status,200);const rules=(await rulesResponse.json()).rules;
  assert.deepEqual(rules.map(row=>row.rewardCoins),[10,15,20,25,30,40,50]);
  const initialCoins=reader.coins;
  const create=await createMission(await request(manager,'/api/admin/growth/missions','POST',{
    title:'签到领取测试',description:'一天签到后领取',rewardCoins:25,category:'DAILY',conditionType:'CHECKIN_COUNT',conditionTarget:1,period:'DAILY',isActive:true,sortOrder:0,startsAt:null,endsAt:null,reason:'隔离自动条件测试',
  }));
  assert.equal(create.status,201);const mission=await create.json();
  const available=await (await publicMissions(await request(reader,'/api/missions'))).json();
  assert.equal(available.length,1);assert.equal(available[0].progress,0);assert.equal(available[0].qualified,false);
  const early=await claimMission(await request(reader,`/api/missions/${mission.id}/complete`),{params:Promise.resolve({id:mission.id})});assert.equal(early.status,409);assert.equal((await early.json()).progress,0);
  assert.equal((await db.user.findUniqueOrThrow({where:{id:reader.id}})).coins,initialCoins);

  const checkin=await doCheckin(await request(reader,'/api/checkin','POST'));assert.equal(checkin.status,200);assert.equal((await checkin.json()).coinsEarned,10);
  const afterCheckin=await (await publicMissions(await request(reader,'/api/missions'))).json();assert.equal(afterCheckin[0].qualified,true);assert.equal(afterCheckin[0].progress,1);
  const claims=await Promise.all(Array.from({length:6},async()=>claimMission(await request(reader,`/api/missions/${mission.id}/complete`),{params:Promise.resolve({id:mission.id})})));
  assert.equal(claims.filter(response=>response.status===200).length,1);assert.equal(claims.filter(response=>response.status===409).length,5);
  assert.equal((await db.user.findUniqueOrThrow({where:{id:reader.id}})).coins,initialCoins+35);
  assert.equal(await db.coinTransaction.count({where:{userId:reader.id,type:'EARNED'}}),2);
  assert.equal(await db.coinTransaction.count({where:{userId:reader.id,sourceKey:'CHECKIN_REWARD'}}),1);
  assert.equal(await db.coinTransaction.count({where:{userId:reader.id,sourceKey:'MISSION_REWARD'}}),1);
  assert.equal((await checkinStatus(await request(reader,'/api/checkin'))).status,200);
  assert.equal((await (await checkinStatus(await request(reader,'/api/checkin'))).json()).nextCoins,15);
  assert.equal((await doCheckin(await request(reader,'/api/checkin','POST'))).status,409);

  const save=await saveCheckinRules(await request(manager,'/api/admin/growth/checkins','PUT',{
    rules:rules.map(rule=>({...rule,rewardCoins:rule.streakDay===2?77:rule.rewardCoins})),reason:'验证可审计奖励档位更新',
  }));assert.equal(save.status,200);
  assert.equal((await (await checkinStatus(await request(reader,'/api/checkin'))).json()).nextCoins,77);
  const staleSave=await saveCheckinRules(await request(manager,'/api/admin/growth/checkins','PUT',{rules,reason:'旧签到配置版本'}));assert.equal(staleSave.status,409);
  const audit=await db.adminAuditLog.findFirst({where:{actorId:manager.id,action:'UPDATE_CHECKIN_REWARDS'}});assert(audit);

  const stale=await updateMission(await request(manager,`/api/admin/growth/missions/${mission.id}`,'PATCH',{...mission,version:0,reason:'并发旧版本'}),{params:Promise.resolve({id:mission.id})});
  assert.equal(stale.status,409);
  assert.equal((await db.userMission.count({where:{userId:reader.id,missionId:mission.id}})),1);

  const raceUser=await db.user.create({data:{username:'growth_checkin_race_'+process.pid,email:'growth-checkin-race-'+process.pid+'@example.invalid',passwordHash:'synthetic'}});
  const checkins=await Promise.all(Array.from({length:6},async()=>doCheckin(await request(raceUser,'/api/checkin','POST'))));
  assert.equal(checkins.filter(response=>response.status===200).length,1);assert.equal(checkins.filter(response=>response.status===409).length,5);
  assert.equal(await db.checkin.count({where:{userId:raceUser.id}}),1);assert.equal((await db.user.findUniqueOrThrow({where:{id:raceUser.id}})).coins,110);
});

test('creator character quest reward requires verified conversation messages',async()=>{
  const character=await db.character.create({data:{name:'Growth quest fixture',personality:'test',background:'test',creatorId:owner.id,isPublic:true,reviewStatus:'APPROVED'}});
  const created=await createCharacterQuest(await request(owner,`/api/characters/${character.id}/quests`,'POST',{title:'Send two messages',rewardCoins:30,requiredMessages:2}),{params:Promise.resolve({id:character.id})});
  assert.equal(created.status,201);const quest=(await created.json()).quest;
  const publicQuests=await readCharacterQuests(await request(null,`/api/characters/${character.id}/quests`),{params:Promise.resolve({id:character.id})});
  assert.equal(publicQuests.status,200);assert.equal((await publicQuests.json())[0].progress,0);
  assert.equal((await createCharacterQuest(await request(reader,`/api/characters/${character.id}/quests`,'POST',{title:'越权任务'}),{params:Promise.resolve({id:character.id})})).status,403);
  const before=(await db.user.findUniqueOrThrow({where:{id:reader.id}})).coins;
  const early=await claimCharacterQuest(await request(reader,`/api/characters/${character.id}/quests/${quest.id}/complete`),{params:Promise.resolve({id:character.id,questId:quest.id})});
  assert.equal(early.status,409);assert.equal((await early.json()).target,2);assert.equal((await db.user.findUniqueOrThrow({where:{id:reader.id}})).coins,before);
  const conversation=await db.conversation.create({data:{userId:reader.id,characterId:character.id}});
  await db.message.createMany({data:[{conversationId:conversation.id,role:'USER',content:'one'},{conversationId:conversation.id,role:'USER',content:'two'}]});
  const payouts=await Promise.all(Array.from({length:5},async()=>claimCharacterQuest(await request(reader,`/api/characters/${character.id}/quests/${quest.id}/complete`),{params:Promise.resolve({id:character.id,questId:quest.id})})));
  assert.equal(payouts.filter(response=>response.status===200).length,1);assert.equal(payouts.filter(response=>response.status===409).length,4);
  assert.equal((await db.user.findUniqueOrThrow({where:{id:reader.id}})).coins,before+30);
  const progress=await readCharacterQuests(await request(reader,`/api/characters/${character.id}/quests`),{params:Promise.resolve({id:character.id})});
  assert.equal((await progress.json())[0].isCompleted,true);
  assert.equal(await db.coinTransaction.count({where:{userId:reader.id,sourceKey:'CHARACTER_QUEST_REWARD'}}),1);
  const rewardReportResponse=await readRewardReport(await request(manager,'/api/admin/growth/rewards?days=7'));assert.equal(rewardReportResponse.status,200);
  const rewardReport=await rewardReportResponse.json();assert.equal(rewardReport.totalClaims,4);assert.equal(rewardReport.totalCoins,75);assert.equal(rewardReport.budgetLimitConfigured,false);
  assert.deepEqual(rewardReport.sources.map(row=>[row.key,row.claims,row.coins]),[['CHECKIN_REWARD',2,20],['MISSION_REWARD',1,25],['CHARACTER_QUEST_REWARD',1,30]]);
  assert.equal((await readRewardReport(await request(reader,'/api/admin/growth/rewards'))).status,403);
  assert.equal((await readRewardReport(await request(manager,'/api/admin/growth/rewards?days=14'))).status,400);
  const giftBefore=(await db.user.findUniqueOrThrow({where:{id:reader.id}})).coins;
  const gift=await sendGift(await request(reader,`/api/characters/${character.id}/gift`,'POST',{amount:10,giftCode:'rose'}),{params:Promise.resolve({id:character.id})});
  assert.equal(gift.status,201);assert.equal((await db.user.findUniqueOrThrow({where:{id:reader.id}})).coins,giftBefore-10);
  assert.equal(await db.coinTransaction.count({where:{userId:reader.id,type:'SPENT',amount:-10}}),1);
  const mismatched=await sendGift(await request(reader,`/api/characters/${character.id}/gift`,'POST',{amount:11,giftCode:'rose'}),{params:Promise.resolve({id:character.id})});assert.equal(mismatched.status,409);
  assert.equal((await db.user.findUniqueOrThrow({where:{id:reader.id}})).coins,giftBefore-10);
});

test('gift catalog is permissioned, audited, server-priced and supports disabling',async()=>{
  assert.equal((await readGiftCatalog(await request(reader,'/api/admin/growth/gifts'))).status,403);
  const publicBefore=await (await publicGiftCatalog()).json();assert(publicBefore.gifts.some(item=>item.code==='rose'&&item.coinPrice===10));
  const created=await createGift(await request(manager,'/api/admin/growth/gifts','POST',{code:'blue_star',name:'蓝星',description:'测试目录礼物',emoji:'⭐',coinPrice:25,isActive:true,sortOrder:1,reason:'隔离目录测试'}));
  assert.equal(created.status,201);const item=await created.json();
  const character=await db.character.create({data:{name:'Gift catalog fixture',personality:'test',background:'test',creatorId:owner.id,isPublic:true,reviewStatus:'APPROVED'}});
  const before=(await db.user.findUniqueOrThrow({where:{id:reader.id}})).coins;
  const stale=await sendGift(await request(reader,`/api/characters/${character.id}/gift`,'POST',{giftId:item.id,amount:24}),{params:Promise.resolve({id:character.id})});assert.equal(stale.status,409);
  const sent=await sendGift(await request(reader,`/api/characters/${character.id}/gift`,'POST',{giftId:item.id,amount:25}),{params:Promise.resolve({id:character.id})});assert.equal(sent.status,201);
  assert.equal((await db.user.findUniqueOrThrow({where:{id:reader.id}})).coins,before-25);
  const disabled=await updateGift(await request(manager,`/api/admin/growth/gifts/${item.id}`,'PATCH',{...item,isActive:false,reason:'测试停用'}),{params:Promise.resolve({id:item.id})});assert.equal(disabled.status,200);
  const rejected=await sendGift(await request(reader,`/api/characters/${character.id}/gift`,'POST',{giftId:item.id}),{params:Promise.resolve({id:character.id})});assert.equal(rejected.status,404);
  assert.equal((await db.gift.findFirstOrThrow({where:{senderId:reader.id,characterId:character.id}})).amount,25);
  assert(await db.adminAuditLog.findFirst({where:{actorId:manager.id,action:'CREATE_GIFT_CATALOG'}}));
});
