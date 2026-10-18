import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync,readdirSync} from 'node:fs';
import path from 'node:path';

const file=`operations-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL=`file:./${file}`;process.env.JWT_SECRET=randomUUID()+randomUUID();process.env.PAYMENT_ADMIN_USER_IDS='';process.env.MODERATOR_USER_IDS='';
const env={...process.env};delete env.RUST_LOG;
const migration=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});assert.equal(migration.status,0,migration.stdout+migration.stderr);
const {db}=await import('../src/lib/db.ts');
const {signToken}=await import('../src/lib/auth.ts');
const {bootstrapOwner,saveOperator}=await import('../src/lib/admin/management-service.ts');
const {GET}=await import('../src/app/api/admin/operations/route.ts');
const {GET:backupsRoute}=await import('../src/app/api/admin/operations/backups/route.ts');
const {buildOperationsAlerts,compareMigrationHistory}=await import('../src/lib/operations/report-service.ts');
const owner=await db.user.create({data:{username:`ops_owner_${process.pid}`,email:`ops-owner-${process.pid}@example.invalid`,passwordHash:'synthetic'}});
const viewer=await db.user.create({data:{username:`ops_viewer_${process.pid}`,email:`ops-viewer-${process.pid}@example.invalid`,passwordHash:'synthetic'}});
const ordinary=await db.user.create({data:{username:`ops_user_${process.pid}`,email:`ops-user-${process.pid}@example.invalid`,passwordHash:'synthetic'}});
await bootstrapOwner(owner.email);const role=await db.adminRole.findUniqueOrThrow({where:{code:'OPERATIONS_VIEWER'}});
await saveOperator(owner.id,{userId:viewer.id,enabled:true,version:0,roleIds:[role.id],reason:'隔离运维查看权限'});
const token=user=>signToken({userId:user.id,email:user.email,tokenVersion:user.tokenVersion});
const request=async user=>new Request('http://localhost/api/admin/operations',{headers:user?{Authorization:`Bearer ${await token(user)}`}:{}});
test.after(async()=>{await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])rmSync(path.resolve('prisma',file+suffix),{force:true});});

test('operations overview requires its read role and exposes status metadata only',async()=>{
  assert.equal((await GET(await request(null))).status,401);assert.equal((await GET(await request(ordinary))).status,403);
  const response=await GET(await request(viewer));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);
  const report=await response.json();assert.equal(report.database.connected,true);assert(report.database.migrations.appliedCount>=40);assert.equal(report.database.migrations.pendingCount,0);assert.equal(report.database.migrations.failedCount,0);assert(Array.isArray(report.alerts));
  const latestMigration=readdirSync('prisma/migrations',{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort().at(-1);
  assert.equal(report.database.migrations.lastMigration,latestMigration);assert(Number.isFinite(Date.parse(report.database.migrations.lastAppliedAt)));
  assert.equal(report.runtime.installation,path.basename(process.cwd()));assert.equal(typeof report.runtime.nodeVersion,'string');assert.equal(typeof report.backups.directoryPresent,'boolean');assert.equal(typeof report.backups.singleFileBackups,'number');assert.equal(typeof report.backups.stateBundles,'number');
  assert.deepEqual(report.capabilities,{backupCreation:'命令行操作',restore:'仅支持恢复到新隔离目录',certificateRenewal:'由服务器外部运维流程执行',externalAlerts:'当前未配置'});
  const safe=JSON.stringify(report);assert(!safe.includes(owner.email));assert(!safe.includes('DATABASE_URL'));assert(!safe.includes('prisma/backups'));
});

test('operations alert projection identifies failed/pending migrations and missing local backups',()=>{
  const alerts=buildOperationsAlerts({pendingCount:2,failedCount:1},{directoryPresent:false,singleFileBackups:0,stateBundles:0});
  assert.deepEqual(alerts.map(alert=>alert.code),['MIGRATION_FAILED','MIGRATION_PENDING','BACKUP_UNAVAILABLE']);
  assert.deepEqual(buildOperationsAlerts({pendingCount:0,failedCount:0},{directoryPresent:true,singleFileBackups:1,stateBundles:0}),[]);
});

test('migration comparison matches names and separates rollback history from active failures',()=>{
  const record=(name,finished=100,rolled=null)=>({migration_name:name,finished_at:finished,rolled_back_at:rolled});
  const status=compareMigrationHistory([record('a'),record('old'),record('retry',null,50),record('failed',null)],['a','new']);
  assert.equal(status.appliedCount,2);assert.equal(status.availableCount,2);
  assert.equal(status.pendingCount,1);assert.equal(status.unexpectedCount,1);assert.equal(status.failedCount,1);
  assert.equal(status.lastMigration,'old');
  const alerts=buildOperationsAlerts(status,{directoryPresent:true,singleFileBackups:1,stateBundles:0});
  assert(alerts.some(alert=>alert.code==='MIGRATION_UNEXPECTED'));assert(alerts.some(alert=>alert.code==='MIGRATION_PENDING'));
  const unknown=compareMigrationHistory([record('a')],null);
  assert.equal(unknown.pendingCount,null);assert.equal(unknown.unexpectedCount,null);
  assert.deepEqual(buildOperationsAlerts(unknown,{directoryPresent:true,singleFileBackups:1,stateBundles:0}).map(alert=>alert.code),['MIGRATION_DIRECTORY_UNAVAILABLE']);
});

test('overview detects equal-count migration mismatch in the isolated database',async()=>{
  const original=readdirSync('prisma/migrations',{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort().at(-1);
  const unexpected='synthetic_other_release';
  await db.$executeRaw`UPDATE _prisma_migrations SET migration_name=${unexpected} WHERE migration_name=${original}`;
  try{
    const response=await GET(await request(viewer));assert.equal(response.status,200);
    const report=await response.json();const status=report.database.migrations;
    assert.equal(status.availableCount,status.appliedCount);assert.equal(status.pendingCount,1);assert.equal(status.unexpectedCount,1);
    assert(report.alerts.some(alert=>alert.code==='MIGRATION_UNEXPECTED'));
    assert(report.alerts.some(alert=>alert.code==='MIGRATION_PENDING'));
    assert(!JSON.stringify(report.alerts).includes(unexpected));
  }finally{await db.$executeRaw`UPDATE _prisma_migrations SET migration_name=${original} WHERE migration_name=${unexpected}`;}
});

test('backup catalog API requires operations read permission and rejects invalid page input',async()=>{
  const url='http://localhost/api/admin/operations/backups';
  assert.equal((await backupsRoute(new Request(url))).status,401);
  assert.equal((await backupsRoute(new Request(url,{headers:{Authorization:`Bearer ${await token(ordinary)}`}}))).status,403);
  const headers={Authorization:`Bearer ${await token(viewer)}`};
  for(const page of ['0','-1','abc','10001'])assert.equal((await backupsRoute(new Request(url+'?page='+page,{headers}))).status,400);
  const response=await backupsRoute(new Request(url,{headers}));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);const body=await response.json();assert.equal(body.pageSize,20);assert(Array.isArray(body.items));const safe=JSON.stringify(body);assert(!safe.includes('prisma/backups'));assert(!safe.includes(owner.email));assert(!safe.includes('passwordHash'));
});
