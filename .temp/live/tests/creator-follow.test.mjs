import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file=`creator-follow-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL=`file:./${file}`;process.env.JWT_SECRET=randomUUID()+randomUUID();process.env.PAYMENT_ADMIN_USER_IDS='';process.env.MODERATOR_USER_IDS='';
const env={...process.env};delete env.RUST_LOG;
const migration=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});assert.equal(migration.status,0,migration.stdout+migration.stderr);
const {db}=await import('../src/lib/db.ts');
const {signToken}=await import('../src/lib/auth.ts');
const {POST,DELETE}=await import('../src/app/api/creators/[username]/follow/route.ts');
const {GET:readCreator}=await import('../src/app/api/creators/[username]/route.ts');
const {GET:readCreatorActivity}=await import('../src/app/api/creators/[username]/activity/route.ts');
const {GET:readCreatorConnections}=await import('../src/app/api/creators/[username]/connections/route.ts');
const {GET:listCreators}=await import('../src/app/api/creators/route.ts');
const createUser=async name=>db.user.create({data:{username:`follow_${name}_${process.pid}`,email:`follow-${name}-${process.pid}@example.invalid`,passwordHash:'synthetic'}});
const actor=await createUser('actor'),creator=await createUser('creator'),parallelActor=await createUser('parallel'),parallelCreator=await createUser('parallel_creator');
const makeRequest=async(user,method)=>{const headers=user?{Authorization:'Bearer '+await signToken({userId:user.id,email:user.email,tokenVersion:user.tokenVersion})}:{};return new Request(`http://localhost/api/creators/${creator.username}/follow`,{method,headers});};
const params=username=>({params:Promise.resolve({username})});
test.after(async()=>{await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])rmSync(path.resolve('prisma',file+suffix),{force:true});});

test('creator follow routes delegate idempotent writes and follower-count maintenance to the creator domain',async()=>{
  assert.equal((await POST(await makeRequest(null,'POST'),params(creator.username))).status,401);
  assert.equal((await POST(await makeRequest(actor,'POST'),params(actor.username))).status,400);
  assert.equal((await POST(await makeRequest(actor,'POST'),params('missing_'+process.pid))).status,404);
  const first=await POST(await makeRequest(actor,'POST'),params(creator.username));assert.equal(first.status,200);assert.deepEqual(await first.json(),{following:true,changed:true,followerCount:1});
  const repeated=await POST(await makeRequest(actor,'POST'),params(creator.username));assert.equal(repeated.status,200);assert.deepEqual(await repeated.json(),{following:true,changed:false,followerCount:1});
  assert.equal((await db.user.findUniqueOrThrow({where:{id:creator.id}})).followerCount,1);assert.equal(await db.follow.count({where:{followingId:creator.id}}),1);
  const removed=await DELETE(await makeRequest(actor,'DELETE'),params(creator.username));assert.equal(removed.status,200);assert.deepEqual(await removed.json(),{following:false,changed:true,followerCount:0});
  const repeatedRemoval=await DELETE(await makeRequest(actor,'DELETE'),params(creator.username));assert.equal(repeatedRemoval.status,200);assert.deepEqual(await repeatedRemoval.json(),{following:false,changed:false,followerCount:0});
  const parallelToken=await signToken({userId:parallelActor.id,email:parallelActor.email,tokenVersion:parallelActor.tokenVersion});
  const parallel=await Promise.all(Array.from({length:5},()=>POST(new Request(`http://localhost/api/creators/${parallelCreator.username}/follow`,{method:'POST',headers:{Authorization:'Bearer '+parallelToken}}),params(parallelCreator.username))));
  assert(parallel.every(response=>response.status===200));assert.equal(await db.follow.count({where:{followerId:parallelActor.id,followingId:parallelCreator.id}}),1);assert.equal((await db.user.findUniqueOrThrow({where:{id:parallelCreator.id}})).followerCount,1);
});

test('creator read routes keep public profile, activity, connections and ranking queries in the creator domain',async()=>{
  const publicCharacter=await db.character.create({data:{name:'Public profile character',personality:'kind',background:'',creatorId:creator.id,isPublic:true,reviewStatus:'APPROVED',chatCount:7,messageCount:11,likeCount:3}});
  await db.character.create({data:{name:'Private profile character',personality:'private',background:'',creatorId:creator.id,isPublic:false,reviewStatus:'DRAFT'}});
  await db.user.update({where:{id:creator.id},data:{characterCount:2}});
  const profileResponse=await readCreator(new Request('http://localhost/api/creators/profile'),{params:Promise.resolve({username:creator.username})});
  assert.equal(profileResponse.status,200);
  const profile=await profileResponse.json();
  assert.equal(profile.creator.publicCharacterCount,1);
  assert.equal(profile.creator.chatCount,7);
  assert.deepEqual(profile.characters.map(row=>row.id),[publicCharacter.id]);

  const followerResponse=await readCreatorConnections(new Request('http://localhost/api/creators/profile/connections?type=followers'),{params:Promise.resolve({username:creator.username})});
  assert.equal(followerResponse.status,200);
  assert.equal((await followerResponse.json()).total,0);
  assert.equal((await readCreatorConnections(new Request('http://localhost/api/creators/profile/connections?type=invalid'),{params:Promise.resolve({username:creator.username})})).status,400);

  const circle=await db.circle.create({data:{name:'Creator activity circle',description:'test'}});
  const post=await db.post.create({data:{circleId:circle.id,authorId:creator.id,characterId:publicCharacter.id,content:'Visible activity'}});
  const activityResponse=await readCreatorActivity(new Request('http://localhost/api/creators/profile/activity?limit=1'),{params:Promise.resolve({username:creator.username})});
  assert.equal(activityResponse.status,200);
  const activity=await activityResponse.json();
  assert.equal(activity.posts[0].id,post.id);
  assert.deepEqual(activity.posts[0].character,{id:publicCharacter.id,name:publicCharacter.name});

  const rankingResponse=await listCreators(new Request('http://localhost/api/creators?sort=popularByFollowerCount'));
  assert.equal(rankingResponse.status,200);
  const creators=await rankingResponse.json();
  assert.equal(creators.find(row=>row.id===creator.id).rank,1);
});
