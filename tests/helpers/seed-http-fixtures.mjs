/** Explicit fixtures for the isolated HTTP suite; never part of product seeding. */
export async function seedHttpFixtures(db){
  for(const [id,conditionType,period,sortOrder] of [
    ['http-fixture-checkin','CHECKIN_COUNT','DAILY',-200],
    ['http-fixture-message','MESSAGE_COUNT','ONCE',-199],
  ]){
    const data={title:id,description:'Isolated HTTP test fixture',conditionType,conditionTarget:1,period,rewardCoins:10,isActive:true,sortOrder};
    await db.mission.upsert({where:{id},create:{id,...data},update:data});
  }
  const gift={code:'http-balance-test',name:'Isolated balance test gift',coinPrice:100,isActive:true};
  await db.giftCatalogItem.upsert({where:{id:'http-fixture-gift'},create:{id:'http-fixture-gift',...gift},update:gift});
}
