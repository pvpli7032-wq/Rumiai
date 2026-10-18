import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {cpSync,mkdirSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {PrismaClient} from '@prisma/client';

test('payment merchant migration preserves prior orders and adds revision/audit permission boundaries',async()=>{
  const root=path.resolve('artifacts'),work=mkdtempSync(path.join(root,'payment-merchant-migration-')),schema=path.join(work,'prisma'),file=path.join(work,'merchant.db');mkdirSync(path.join(schema,'migrations'),{recursive:true});cpSync('prisma/schema.prisma',path.join(schema,'schema.prisma'));
  for(const entry of readdirSync('prisma/migrations',{withFileTypes:true}))if(entry.isDirectory()&&entry.name<'20261014130000_payment_merchant_management')cpSync(path.join('prisma/migrations',entry.name),path.join(schema,'migrations',entry.name),{recursive:true});
  const env={...process.env,DATABASE_URL:`file:${file.replaceAll(path.sep,'/')}`};delete env.RUST_LOG;const deploy=()=>{const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema',path.join(schema,'schema.prisma')],{env,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stdout+result.stderr);};let sqlite,client;
  try{deploy();client=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});const row=await client.user.create({data:{username:'merchant-migration',email:'merchant-migration@example.invalid',passwordHash:'synthetic'}});sqlite=new DatabaseSync(file);const now=Date.now();sqlite.prepare('INSERT INTO admin_roles(id,code,name,system,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('migration_owner','OWNER','所有者',1,0,now,now);sqlite.prepare('INSERT INTO payment_orders(id,order_no,idempotency_key,user_id,package_coins,package_bonus,coin_amount,amount_cny_cents,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('legacy_order','LEGACY-ORDER','legacy-key',row.id,100,0,100,100,now);sqlite.close();sqlite=null;cpSync('prisma/migrations/20261014130000_payment_merchant_management',path.join(schema,'migrations','20261014130000_payment_merchant_management'),{recursive:true});deploy();sqlite=new DatabaseSync(file);
    const order=sqlite.prepare('SELECT order_no,merchant_revision_id,coin_amount,amount_cny_cents FROM payment_orders WHERE id=?').get('legacy_order');assert.deepEqual({...order},{order_no:'LEGACY-ORDER',merchant_revision_id:null,coin_amount:100,amount_cny_cents:100});
    const cols=new Set(sqlite.prepare('PRAGMA table_info(payment_merchant_revisions)').all().map(row=>row.name));for(const col of ['merchant_no','private_key_ciphertext','platform_key_ciphertext','revision','refunds_enabled'])assert(cols.has(col));assert(sqlite.prepare("SELECT COUNT(*) AS count FROM pragma_index_list('payment_merchants') WHERE name='payment_merchants_active_slot_key' AND \"unique\"=1").get().count===1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM admin_role_permissions WHERE role_id IN (SELECT id FROM admin_roles WHERE code='OWNER') AND permission LIKE 'payments.merchants.%'").get().count,4);assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM admin_role_permissions WHERE role_id='system_payment_merchant_manager'").get().count,4);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL').get().count,27);assert.equal(sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{sqlite?.close();if(client)await client.$disconnect();assert.equal(path.dirname(path.resolve(work)),root);rmSync(work,{recursive:true,force:true});}
});
