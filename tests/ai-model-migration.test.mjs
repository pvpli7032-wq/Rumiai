import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {cpSync,mkdirSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

test('AI model migration preserves provider rows and grants isolated model-routing permissions',()=>{
  const root=path.resolve('artifacts'),work=mkdtempSync(path.join(root,'ai-model-migration-')),schema=path.join(work,'prisma'),file=path.join(work,'models.db');mkdirSync(path.join(schema,'migrations'),{recursive:true});cpSync('prisma/schema.prisma',path.join(schema,'schema.prisma'));
  for(const entry of readdirSync('prisma/migrations',{withFileTypes:true}))if(entry.isDirectory()&&entry.name<'20261014120000_ai_model_routing')cpSync(path.join('prisma/migrations',entry.name),path.join(schema,'migrations',entry.name),{recursive:true});
  const env={...process.env,DATABASE_URL:`file:${file.replaceAll(path.sep,'/')}`};delete env.RUST_LOG;const deploy=()=>{const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema',path.join(schema,'schema.prisma')],{env,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stdout+result.stderr);};let db;
  try{deploy();db=new DatabaseSync(file);const now=Date.now();db.prepare('INSERT INTO admin_roles(id,code,name,system,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('owner','OWNER','所有者',1,0,now,now);db.prepare('INSERT INTO ai_providers(id,name,protocol,base_url,is_active,sort_order,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('provider','existing-provider','OPENAI_COMPATIBLE','https://api.example.invalid/v1',1,0,1,now,now);const before=db.prepare('SELECT * FROM ai_providers WHERE id=?').get('provider');db.close();db=null;cpSync('prisma/migrations/20261014120000_ai_model_routing',path.join(schema,'migrations/20261014120000_ai_model_routing'),{recursive:true});deploy();db=new DatabaseSync(file);
    assert.deepEqual(db.prepare('SELECT * FROM ai_providers WHERE id=?').get('provider'),before);const columns=new Set(db.prepare('PRAGMA table_info(ai_models)').all().map(row=>row.name));for(const column of ['key','provider_id','is_default','default_slot','is_fallback','timeout_ms','max_retries','max_output_tokens','last_check_status'])assert(columns.has(column));assert(db.prepare("SELECT COUNT(*) AS count FROM pragma_index_list('ai_models') WHERE name='ai_models_default_slot_key' AND \"unique\"=1").get().count===1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM admin_role_permissions WHERE role_id='system_ai_model_manager'").get().count,4);assert.equal(db.prepare("SELECT COUNT(*) AS count FROM admin_role_permissions p JOIN admin_roles r ON r.id=p.role_id WHERE r.code='OWNER' AND p.permission LIKE 'ai.models.%'").get().count,3);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL').get().count,26);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db?.close();assert.equal(path.dirname(path.resolve(work)),root);rmSync(work,{recursive:true,force:true});}
});
