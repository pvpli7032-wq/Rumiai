import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {cpSync,mkdirSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {PrismaClient} from '@prisma/client';

test('AI cost migration preserves usage data and adds constrained auditable settings',async()=>{
  const root=path.resolve('artifacts'),work=mkdtempSync(path.join(root,'ai-cost-migration-')),schema=path.join(work,'prisma'),file=path.join(work,'cost.db');
  mkdirSync(path.join(schema,'migrations'),{recursive:true});cpSync('prisma/schema.prisma',path.join(schema,'schema.prisma'));
  for(const entry of readdirSync('prisma/migrations',{withFileTypes:true})){
    if(entry.isDirectory()&&entry.name<'20261014140000_ai_cost_management')cpSync(path.join('prisma/migrations',entry.name),path.join(schema,'migrations',entry.name),{recursive:true});
  }
  const env={...process.env,DATABASE_URL:`file:${file.replaceAll(path.sep,'/')}`};delete env.RUST_LOG;
  const deploy=()=>{const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema',path.join(schema,'schema.prisma')],{env,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stdout+result.stderr);};
  let sqlite,client;
  try{
    deploy();client=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
    const user=await client.user.create({data:{username:'ai-cost-migration',email:'ai-cost-migration@example.invalid',passwordHash:'synthetic'}});
    sqlite=new DatabaseSync(file);const now=Date.now();
    sqlite.prepare('INSERT INTO admin_roles(id,code,name,system,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('owner','OWNER','所有者',1,0,now,now);
    sqlite.prepare('INSERT INTO ai_calls(id,user_id,conversation_id,operation,status,model,attempts,input_tokens,output_tokens,estimated_cost,currency,started_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('kept_call',user.id,'kept-conversation','SEND','SUCCEEDED','fixture-model',1,10,20,0.25,'USD',now);
    sqlite.close();sqlite=null;
    cpSync('prisma/migrations/20261014140000_ai_cost_management',path.join(schema,'migrations','20261014140000_ai_cost_management'),{recursive:true});deploy();sqlite=new DatabaseSync(file);
    assert.equal(sqlite.prepare('SELECT estimated_cost FROM ai_calls WHERE id=?').get('kept_call').estimated_cost,0.25);
    const budgetColumns=new Set(sqlite.prepare('PRAGMA table_info(ai_daily_cost_budgets)').all().map(row=>row.name));for(const column of ['currency','site_limit','user_limit','is_active','version','updated_by'])assert(budgetColumns.has(column));
    const policyColumns=new Set(sqlite.prepare('PRAGMA table_info(ai_cost_policies)').all().map(row=>row.name));for(const column of ['circuit_breaker_enabled','version','updated_by'])assert(policyColumns.has(column));
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM admin_role_permissions WHERE role_id IN (SELECT id FROM admin_roles WHERE code='OWNER') AND permission LIKE 'ai.costs.%'").get().count,2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM admin_role_permissions WHERE role_id='system_ai_cost_manager'").get().count,2);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL').get().count,28);
    assert.throws(()=>sqlite.prepare("INSERT INTO ai_daily_cost_budgets(currency,site_limit,is_active,version,updated_by,updated_at) VALUES('usd',1,1,1,'actor',?)").run(now));
    assert.equal(sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{sqlite?.close();if(client)await client.$disconnect();assert.equal(path.dirname(path.resolve(work)),root);rmSync(work,{recursive:true,force:true});}
});

