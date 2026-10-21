import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file=`analytics-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL=`file:./${file}`;process.env.JWT_SECRET=randomUUID()+randomUUID();
process.env.PAYMENT_ADMIN_USER_IDS='';process.env.MODERATOR_USER_IDS='';
delete process.env.RUST_LOG;
const env={...process.env};delete env.RUST_LOG;
const migration=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});
assert.equal(migration.status,0,migration.stdout+migration.stderr);
const {db}=await import('../src/lib/db.ts');
const {getAuthUser,signToken}=await import('../src/lib/auth.ts');
const {bootstrapOwner,saveOperator}=await import('../src/lib/admin/management-service.ts');
const {readAnalyticsReport}=await import('../src/lib/analytics/report-service.ts');
const {GET}=await import('../src/app/api/admin/analytics/route.ts');
const now=new Date();
const owner=await db.user.create({data:{username:'analytics_owner_'+process.pid,email:'analytics-owner-'+process.pid+'@example.invalid',passwordHash:'synthetic'}});
const viewer=await db.user.create({data:{username:'analytics_viewer_'+process.pid,email:'analytics-viewer-'+process.pid+'@example.invalid',passwordHash:'synthetic',lastActiveAt:now}});
const ordinary=await db.user.create({data:{username:'analytics_user_'+process.pid,email:'analytics-user-'+process.pid+'@example.invalid',passwordHash:'synthetic',lastActiveAt:now}});
const oldCohortDate=new Date(now.getTime()-35*86400000);
const oldCohort=await db.user.create({data:{username:'analytics_cohort_'+process.pid,email:'analytics-cohort-'+process.pid+'@example.invalid',passwordHash:'synthetic',createdAt:oldCohortDate}});
await db.userActivityDay.createMany({data:[1,7,30].map(offset=>({userId:oldCohort.id,activityDate:new Date(Date.UTC(oldCohortDate.getUTCFullYear(),oldCohortDate.getUTCMonth(),oldCohortDate.getUTCDate()+offset))}))});
const erasedUser=await db.user.create({data:{username:'analytics_erased_'+process.pid,email:'analytics-erased-'+process.pid+'@example.invalid',passwordHash:'synthetic'}});
await db.userActivityDay.create({data:{userId:erasedUser.id,activityDate:new Date()}});await db.user.delete({where:{id:erasedUser.id}});assert.equal(await db.userActivityDay.count({where:{userId:erasedUser.id}}),0);
await bootstrapOwner(owner.email);
const role=await db.adminRole.findUniqueOrThrow({where:{code:'ANALYTICS_VIEWER'}});
await saveOperator(owner.id,{userId:viewer.id,enabled:true,version:0,roleIds:[role.id],reason:'隔离分析权限测试'});
const character=await db.character.create({data:{name:'Synthetic persona',personality:'test',background:'test',creatorId:ordinary.id}});
const conversation=await db.conversation.create({data:{userId:ordinary.id,characterId:character.id}});
await db.message.createMany({data:[
  {conversationId:conversation.id,role:'USER',content:'synthetic',createdAt:now},
  {conversationId:conversation.id,role:'ASSISTANT',content:'synthetic',createdAt:now},
]});
const circle=await db.circle.create({data:{name:'Analytics fixture',description:'synthetic'}});
const post=await db.post.create({data:{circleId:circle.id,authorId:ordinary.id,content:'synthetic',status:'VISIBLE',createdAt:now}});
await db.postComment.create({data:{postId:post.id,authorId:ordinary.id,content:'synthetic',status:'VISIBLE',createdAt:now}});
await db.moderationAction.create({data:{actorId:owner.id,targetType:'USER',targetId:ordinary.id,action:'TEST',reason:'synthetic',createdAt:now}});
await db.aiCall.createMany({data:[
  {userId:ordinary.id,conversationId:conversation.id,operation:'CHAT',status:'SUCCEEDED',model:'synthetic',attempts:1,estimatedCost:0.25,currency:'USD',startedAt:now},
  {userId:ordinary.id,conversationId:conversation.id,operation:'CHAT',status:'FAILED',model:'synthetic',attempts:1,estimatedCost:null,currency:'USD',startedAt:now},
]});
await db.paymentOrder.create({data:{orderNo:'ANALYTICS-PAID-'+process.pid,idempotencyKey:randomUUID(),userId:ordinary.id,packageCoins:60,packageBonus:0,coinAmount:60,amountCnyCents:600,currency:'CNY',status:'PAID',provider:'EZFP',providerTradeNo:'ANALYTICS-TRADE-'+process.pid,paidAt:now,createdAt:now}});
const token=user=>signToken({userId:user.id,email:user.email,tokenVersion:user.tokenVersion});
const req=async(user,url)=>new Request('http://localhost'+url,{headers:user?{Authorization:'Bearer '+await token(user)}:{}});
test.after(async()=>{await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])rmSync(path.resolve('prisma',file+suffix),{force:true});});

test('analytics reports real scoped aggregates, protects permission and states unavailable metrics',async()=>{
  const anonymous=await GET(await req(null,'/api/admin/analytics'));assert.equal(anonymous.status,401);
  const forbidden=await GET(await req(ordinary,'/api/admin/analytics'));assert.equal(forbidden.status,403);
  assert.equal((await GET(await req(viewer,'/api/admin/analytics?days=91'))).status,400);
  const response=await GET(await req(viewer,'/api/admin/analytics?days=7'));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);
  const report=await response.json();
  assert.equal(report.users.registered,3);assert.equal(report.users.active,2);assert.equal(report.users.payingUsers,1);
  assert.equal(report.engagement.newConversations,1);assert.equal(report.engagement.userMessages,1);assert.equal(report.engagement.assistantMessages,1);
  assert.equal(report.engagement.visiblePosts,1);assert.equal(report.engagement.visibleComments,1);assert.equal(report.engagement.moderationActions,1);
  assert.equal(report.payments.paidOrders,1);assert.equal(report.payments.paidAmountCnyCents,600);
  assert.equal(report.aiCosts.find(row=>row.currency==='USD').knownCostCalls,1);assert.equal(report.aiCosts.find(row=>row.currency==='USD').unknownCostCalls,1);
  // 工作台趋势图的数据源：逐日序列按天补齐，缺的日期给 0，不省略成断线。
  assert.equal(report.daily.length,report.days);
  assert.equal(report.daily.reduce((sum,row)=>sum+row.assistantMessages,0),1);
  assert.match(report.daily.at(-1).date,/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(report.definitions.retentionAvailable,true);assert.equal(report.definitions.grossMarginAvailable,false);
  const oldCohortReport=report.retention.cohorts.find(row=>row.cohortDate===oldCohortDate.toISOString().slice(0,10));assert(oldCohortReport,JSON.stringify(report.retention));assert.equal(oldCohortReport.cohortSize,1);assert.equal(oldCohortReport.d1.rate,1);assert.equal(oldCohortReport.d7.rate,1);assert.equal(oldCohortReport.d30.rate,1);
  assert(await getAuthUser(await req(ordinary,'/api/admin/analytics')));assert.equal(await db.userActivityDay.count({where:{userId:ordinary.id}}),1);
  assert(await getAuthUser(await req(ordinary,'/api/admin/analytics')));assert.equal(await db.userActivityDay.count({where:{userId:ordinary.id}}),1);
  assert.equal(JSON.stringify(report).includes(ordinary.email),false);assert.equal(JSON.stringify(report).includes('synthetic persona'),false);

  // Replay the additive permission migration against already-existing operator roles.
  await db.adminRoleAssignment.deleteMany({where:{role:{code:'ANALYTICS_VIEWER'}}});
  await db.adminRolePermission.deleteMany({where:{permission:'analytics.read'}});
  await db.adminRole.delete({where:{code:'ANALYTICS_VIEWER'}});
  await db.$executeRaw`UPDATE _prisma_migrations SET rolled_back_at = CURRENT_TIMESTAMP WHERE migration_name = '20261014170000_analytics_management'`;
  await db.$disconnect();
  const replay=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});
  assert.equal(replay.status,0,replay.stdout+replay.stderr);
  await db.$connect();
  const ownerRole=await db.adminRole.findUniqueOrThrow({where:{code:'OWNER'},include:{permissions:{select:{permission:true}}}});
  assert(ownerRole.permissions.some(item=>item.permission==='analytics.read'));
  assert(await db.adminRole.findUnique({where:{code:'ANALYTICS_VIEWER'}}));
});
