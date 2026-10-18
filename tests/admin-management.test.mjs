import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file = `admin-management-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL = `file:./${file}`;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true});
assert.equal(migration.status, 0, migration.stdout + migration.stderr);
const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {bootstrapOwner, saveOperator, saveRole, readOperatorManagement, readAdminAudit, closeAdminIdentity} = await import('../src/lib/admin/management-service.ts');
const {readAdminAuthorization} = await import('../src/lib/admin/authorization.ts');
const {SYSTEM_ROLES} = await import('../src/lib/admin/permissions.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {exportAccountData} = await import('../src/lib/accounts/data-export.ts');
const {GET: readPackages, POST: createPackage} = await import('../src/app/api/admin/finance/packages/route.ts');
const {GET: readCharacters} = await import('../src/app/api/admin/moderation/characters/route.ts');
const {PUT: reviewCharacter} = await import('../src/app/api/admin/moderation/characters/[id]/route.ts');
const {POST: roleRoute} = await import('../src/app/api/admin/roles/route.ts');
const users = [];
for (let i = 0; i < 5; i++) users.push(await db.user.create({data: {username: `staff_${i}`, email: `staff-${i}@example.invalid`, passwordHash: 'synthetic-only', coins: 300}}));
const owner = users[0], staff = users[1], other = users[2];
const req = async (user, method = 'GET', body) => new Request('http://localhost/api/admin', {method, headers: {Authorization: `Bearer ${await signToken({userId: user.id, email: user.email, tokenVersion: user.tokenVersion})}`, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})});
const rejected = (fn, status) => assert.rejects(fn, error => error.status === status);
const assignment = async (user, roleIds, enabled = true) => saveOperator(owner.id, {userId: user.id, roleIds, enabled, version: (await db.adminOperator.findUnique({where: {userId: user.id}}))?.version ?? 0, reason: '合成权限验收'});
let viewer, moderator, ownerRole, custom;
test.after(async () => {await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});});

test('explicit bootstrap requires a registered identity and preserves account data', async () => {
  await rejected(() => bootstrapOwner('missing@example.invalid'), 404);
  assert.deepEqual(await bootstrapOwner(owner.email), {userId: owner.id, created: true});
  assert.equal((await bootstrapOwner(owner.email)).created, false);
  await rejected(() => bootstrapOwner(other.email), 409);
  const roles = await db.adminRole.findMany();
  viewer = roles.find(role => role.code === 'FINANCE_VIEWER'); moderator = roles.find(role => role.code === 'MODERATOR'); ownerRole = roles.find(role => role.code === 'OWNER');
  assert.deepEqual(roles.map(role=>role.code).sort(),SYSTEM_ROLES.map(role=>role.code).sort()); assert(roles.some(role => role.code === 'SUPPORT_AGENT')); assert(roles.some(role => role.code === 'SITE_CONTENT_MANAGER')); assert(roles.some(role => role.code === 'AI_PROVIDER_MANAGER')); assert(roles.some(role => role.code === 'AI_MODEL_MANAGER')); assert(roles.some(role => role.code === 'AI_COST_MANAGER')); assert(roles.some(role => role.code === 'PAYMENT_MERCHANT_MANAGER')); assert(roles.some(role => role.code === 'ANALYTICS_VIEWER')); assert(roles.some(role => role.code === 'GROWTH_MANAGER')); assert(roles.some(role=>role.code==='FINANCE_REFUND_APPROVER')); assert(roles.some(role=>role.code==='OPERATIONS_VIEWER')); assert.equal((await db.user.findUnique({where: {id: owner.id}})).coins, 300);
  assert.equal(await db.adminAuditLog.count({where: {action: 'BOOTSTRAP_OWNER'}}), 1);
});
test('ordinary users cannot manage roles, including through HTTP', async () => {
  const response = await roleRoute(await req(other, 'POST', {name: '越权', permissions: ['finance.read'], reason: '测试'}));
  assert.equal(response.status, 403); assert.match(response.headers.get('cache-control'), /private, no-store/);
  await rejected(() => readOperatorManagement(other.id), 403);
});
test('finance viewer can read packages but cannot change prices', async () => {
  await assignment(staff, [viewer.id]);
  assert.equal((await readPackages(await req(staff))).status, 200);
  assert.equal((await createPackage(await req(staff, 'POST', {label: '非法修改'}))).status, 403);
});
test('role rules reject system edits, owner powers, prototype keys and inaccessible write grants', async () => {
  await rejected(() => saveRole(owner.id, {id: viewer.id, version: 0, name: '修改系统', permissions: [], reason: '测试'}), 409);
  for (const permissions of [['admin.staff.manage'], ['toString'], ['__proto__'], ['finance.refunds.execute'], ['moderation.write']]) await rejected(() => saveRole(owner.id, {name: '无效角色', permissions, reason: '测试'}), 400);
});
test('read-only moderation succeeds for queues and rejects review writes', async () => {
  custom = await saveRole(owner.id, {name: '审核查看员', permissions: ['moderation.read'], reason: '合成只读角色'});
  await assignment(staff, [custom.id]);
  assert.equal((await readCharacters(await req(staff))).status, 200);
  assert.equal((await reviewCharacter(await req(staff, 'PUT', {}), {params: Promise.resolve({id: 'synthetic'})})).status, 403);
});
test('role changes revoke authority immediately and stale saves have no audit side effect', async () => {
  assert((await readAdminAuthorization(staff.id)).permissions.includes('moderation.read'));
  await saveRole(owner.id, {id: custom.id, version: custom.version, name: '已撤销', permissions: [], reason: '撤销查看权限'});
  assert.equal((await readCharacters(await req(staff))).status, 403);
  const count = await db.adminAuditLog.count();
  await rejected(() => saveRole(owner.id, {id: custom.id, version: custom.version, name: '过期版本', permissions: [], reason: '测试冲突'}), 409);
  assert.equal(await db.adminAuditLog.count(), count);
});
test('managed disabled identity cannot regain legacy privileges and existing login is revoked', async () => {
  process.env.MODERATOR_USER_IDS = staff.id; process.env.PAYMENT_ADMIN_USER_IDS = staff.id;
  await assignment(staff, [moderator.id]);
  const oldRequest = await req(staff);
  await assignment(staff, [moderator.id], false);
  assert.deepEqual((await readAdminAuthorization(staff.id)).permissions, []);
  assert.equal((await readPackages(oldRequest)).status, 401);
  assert.equal((await db.user.findUnique({where: {id: staff.id}})).tokenVersion, 1);
});
test('last owner cannot be disabled, downgraded or closed; failed changes are atomic', async () => {
  const count = await db.adminAuditLog.count();
  await rejected(() => assignment(owner, [viewer.id]), 409);
  await rejected(() => assignment(owner, [ownerRole.id], false), 409);
  await rejected(() => db.$transaction(async tx => {await tx.user.update({where: {id: owner.id}, data: {tokenVersion: {increment: 1}}}); await closeAdminIdentity(tx, owner.id);}), 409);
  assert.equal((await db.user.findUnique({where: {id: owner.id}})).tokenVersion, 0);
  assert.equal((await readAdminAuthorization(owner.id)).owner, true);
  assert.equal(await db.adminAuditLog.count(), count);
});
test('two simultaneous owner removals preserve an active owner', async () => {
  await assignment(other, [ownerRole.id]);
  const version = (await db.adminOperator.findUnique({where: {userId: owner.id}})).version;
  const results = await Promise.allSettled([saveOperator(owner.id, {userId: owner.id, roleIds: [viewer.id], enabled: true, version, reason: '并发降权'}), saveOperator(other.id, {userId: other.id, roleIds: [viewer.id], enabled: true, version: 1, reason: '并发降权'})]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await Promise.all([readAdminAuthorization(owner.id), readAdminAuthorization(other.id)])).filter(result => result.owner).length, 1);
});
test('audits and account exports include administrative metadata without credentials', async () => {
  const actor = (await readAdminAuthorization(owner.id)).owner ? owner : other;
  const report = await readAdminAudit(actor.id);
  assert(report.total >= 8);
  assert(report.items.some(item => item.action === 'SAVE_OPERATOR' && JSON.parse(item.changes).after.roleIds));
  const exported = await exportAccountData(actor.id);
  assert(exported.adminIdentity?.assignments.some(item => item.role.code === 'OWNER'));
  assert(!JSON.stringify(exported).includes('synthetic-only'));
  assert(!JSON.stringify(report).includes('passwordHash'));
});

test('audit filters intersect exact identity/action and inclusive UTC dates with stable pagination',async()=>{
  const actor=(await readAdminAuthorization(owner.id)).owner?owner:other;
  const target='audit-filter-fixture';
  await db.adminAuditLog.createMany({data:[
    ...Array.from({length:26},(_,index)=>({id:`audit-filter-${String(index).padStart(2,'0')}`,actorId:actor.id,targetId:target,action:'FILTER_TEST',reason:'isolated audit',changes:'{}',createdAt:new Date('2026-01-02T23:59:59.999Z')})),
    {actorId:actor.id,targetId:target,action:'FILTER_TEST',reason:'before window',changes:'{}',createdAt:new Date('2026-01-01T23:59:59.999Z')},
    {actorId:actor.id,targetId:target,action:'FILTER_TEST',reason:'after window',changes:'{}',createdAt:new Date('2026-01-03T00:00:00.000Z')},
    {actorId:actor.id,targetId:target,action:'OTHER_TEST',reason:'other action',changes:'{}',createdAt:new Date('2026-01-02T12:00:00.000Z')},
  ]});
  const filters={actorId:actor.id,targetId:target,action:'FILTER_TEST',from:'2026-01-02',until:'2026-01-02'};
  const first=await readAdminAudit(actor.id,1,filters),second=await readAdminAudit(actor.id,2,filters);
  assert.equal(first.total,26);assert.equal(first.items.length,25);assert.equal(second.total,26);assert.equal(second.items.length,1);
  assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,26);
  assert.equal((await readAdminAudit(actor.id,1,{...filters,actorId:'not-the-actor'})).total,0);
  for(const invalid of [{from:'2026-02-30'},{until:'bad'},{from:'2026-01-03',until:'2026-01-02'},{action:'x'.repeat(101)}])await rejected(()=>readAdminAudit(actor.id,1,invalid),400);
  await rejected(()=>readAdminAudit(staff.id,1,filters),403);
});
