import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const file=`admin-access-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL=`file:./${file}`;
process.env.JWT_SECRET=randomUUID()+randomUUID();
const env={...process.env};delete env.RUST_LOG;
const migration=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8'});
assert.equal(migration.status,0,migration.stdout+migration.stderr);
const {db,pragmasReady}=await import('../src/lib/db.ts');await pragmasReady;
const {signToken}=await import('../src/lib/auth.ts');
const {GET}=await import('../src/app/api/admin/access/route.ts');
const {getFinanceAdmin}=await import('../src/lib/payments/finance-auth.ts');
const {getModerator}=await import('../src/lib/moderator.ts');
const users=[];
for(let i=0;i<4;i++)users.push(await db.user.create({data:{username:'admin-fixture-'+i,email:`admin-${i}@example.invalid`,passwordHash:'synthetic-only'}}));
const tokens=new Map();
for(const user of users)tokens.set(user.id,await signToken({userId:user.id,email:user.email,tokenVersion:user.tokenVersion}));
const request=user=>new Request('http://localhost/api/admin/access',{headers:user?{Authorization:'Bearer '+tokens.get(user.id)}:{}});
test.after(async()=>{await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])rmSync(path.resolve('prisma',file+suffix),{force:true});});

test('anonymous, ordinary, moderation, finance and dual roles retain independent authority',async()=>{
 process.env.MODERATOR_USER_IDS=` ${users[1].id},${users[3].id} `;
 process.env.PAYMENT_ADMIN_USER_IDS=` ${users[2].id},${users[3].id} `;
 const anonymous=await GET(request());assert.equal(anonymous.status,401);
 const expected=[{moderation:false,finance:false},{moderation:true,finance:false},{moderation:false,finance:true},{moderation:true,finance:true}];
 for(let i=0;i<users.length;i++){
  const req=request(users[i]);const response=await GET(req);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),expected[i]);
  assert.match(response.headers.get('cache-control'),/private, no-store/);
  assert.equal(Boolean(await getModerator(req)),expected[i].moderation);
  assert.equal((await getFinanceAdmin(req)).status,expected[i].finance?200:403);
 }
});
test('revoking configured privileges affects the same token immediately',async()=>{
 process.env.MODERATOR_USER_IDS='';process.env.PAYMENT_ADMIN_USER_IDS='';
 const req=request(users[3]);assert.deepEqual(await (await GET(req)).json(),{moderation:false,finance:false});
 assert.equal((await getFinanceAdmin(req)).status,403);assert.equal(await getModerator(req),null);
});
test('retired credentials cannot obtain administration capabilities',async()=>{
 const req=request(users[3]);
 await db.user.update({where:{id:users[3].id},data:{tokenVersion:{increment:1}}});
 assert.equal((await GET(req)).status,401);
});
