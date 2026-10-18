import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {cpSync,mkdirSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

test('AI provider migration preserves existing records and grants only the intended system roles',()=>{
  const root=path.resolve('artifacts'),work=mkdtempSync(path.join(root,'ai-provider-migration-')),schema=path.join(work,'prisma'),file=path.join(work,'provider.db');mkdirSync(path.join(schema,'migrations'),{recursive:true});cpSync('prisma/schema.prisma',path.join(schema,'schema.prisma'));
  for(const entry of readdirSync('prisma/migrations',{withFileTypes:true})){if(entry.isDirectory()&&entry.name<'20261014110000_ai_provider_management')cpSync(path.join('prisma/migrations',entry.name),path.join(schema,'migrations',entry.name),{recursive:true});}
  const env={...process.env,DATABASE_URL:`file:${file.replaceAll(path.sep,'/')}`};delete env.RUST_LOG;
  const deploy=()=>{const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema',path.join(schema,'schema.prisma')],{env,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stdout+result.stderr);};
  let db;try{deploy();db=new DatabaseSync(file);const now=Date.now();db.prepare('INSERT INTO admin_roles(id,code,name,system,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('owner','OWNER','所有者',1,0,now,now);db.prepare('INSERT INTO admin_role_permissions(role_id,permission) VALUES(?,?)').run('owner','admin.staff.read');const prior=db.prepare('SELECT * FROM admin_roles WHERE id=?').get('owner');db.close();db=null;
    cpSync('prisma/migrations/20261014110000_ai_provider_management',path.join(schema,'migrations/20261014110000_ai_provider_management'),{recursive:true});deploy();db=new DatabaseSync(file);
    assert.deepEqual(db.prepare('SELECT * FROM admin_roles WHERE id=?').get('owner'),prior);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM admin_role_permissions WHERE role_id='owner'").get().count,5);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM admin_role_permissions p JOIN admin_roles r ON r.id=p.role_id WHERE r.code='AI_PROVIDER_MANAGER'").get().count,4);
    const columns=new Set(db.prepare('PRAGMA table_info(ai_providers)').all().map(row=>row.name));for(const column of ['base_url','secret_ciphertext','secret_nonce','secret_tag','is_active','version'])assert(columns.has(column));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL').get().count,25);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db?.close();assert.equal(path.dirname(path.resolve(work)),root);rmSync(work,{recursive:true,force:true});}
});
