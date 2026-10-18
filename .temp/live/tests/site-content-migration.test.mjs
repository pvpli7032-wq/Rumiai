import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {cpSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

test('site-content migration preserves current catalog rows and adds isolated workflow history', () => {
  const root = path.resolve('artifacts'); mkdirSync(root, {recursive: true});
  const work = mkdtempSync(path.join(root, 'site-content-migration-')), schema = path.join(work, 'prisma'), file = path.join(work, 'source.db');
  mkdirSync(path.join(schema, 'migrations'), {recursive: true}); copyFileSync('prisma/schema.prisma', path.join(schema, 'schema.prisma'));
  for (const entry of readdirSync('prisma/migrations', {withFileTypes: true})) {
    if (!entry.isDirectory() || entry.name >= '20261014090000_site_content_management') continue;
    cpSync(path.join('prisma/migrations', entry.name), path.join(schema, 'migrations', entry.name), {recursive: true});
  }
  const env = {...process.env, DATABASE_URL: 'file:' + file.split(path.sep).join('/')}; delete env.RUST_LOG;
  const deploy = () => {const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', path.join(schema, 'schema.prisma')], {env, encoding: 'utf8', windowsHide: true}); assert.equal(result.status, 0, result.stdout + result.stderr);};
  let c;
  try {
    deploy(); c = new DatabaseSync(file); const now = Date.now();
    c.prepare('INSERT INTO users(id,username,email,password_hash,updated_at) VALUES(?,?,?,?,?)').run('actor', 'actor', 'actor@example.invalid', 'synthetic-only', now);
    c.prepare('INSERT INTO admin_roles(id,code,name,system,updated_at) VALUES(?,?,?,?,?)').run('owner', 'OWNER', '所有者', 1, now);
    c.prepare("INSERT INTO admin_role_permissions(role_id,permission) VALUES('owner','admin.staff.read')").run();
    c.prepare('INSERT INTO banners(id,placement,title,description,href,gradient_from,gradient_to,sort_order,is_active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('banner','HERO','原横幅','原说明','/discover','#112233','#445566',3,1,now);
    c.prepare('INSERT INTO tags(id,key,label,"group",filter_row,sort_order) VALUES(?,?,?,?,?,?)').run('tag','Legacy','保留分类','题材','role',5);
    c.prepare('INSERT INTO badges(id,emoji,label,sort_order) VALUES(?,?,?,?)').run('badge','✨','原徽章',6);
    c.prepare('INSERT INTO home_sections(id,key,emoji,title,source,sort_order,is_active) VALUES(?,?,?,?,?,?,?)').run('section','legacy','✨','原展示区','TAG',7,1);
    const snapshot = new Map(['banners','tags','badges','home_sections'].map(table => [table,c.prepare(`SELECT * FROM "${table}"`).all()]));
    c.close(); c = null;
    cpSync('prisma/migrations/20261014090000_site_content_management', path.join(schema, 'migrations/20261014090000_site_content_management'), {recursive: true}); deploy(); c = new DatabaseSync(file);
    for (const [table, rows] of snapshot) {
      const oldColumns = Object.keys(rows[0]);
      assert.deepEqual(c.prepare(`SELECT ${oldColumns.map(name=>`"${name}"`).join(',')} FROM "${table}"`).all(), rows, table);
    }
    assert.equal(c.prepare("SELECT is_active FROM tags WHERE id='tag'").get().is_active, 1);
    assert.equal(c.prepare("SELECT is_active FROM badges WHERE id='badge'").get().is_active, 1);
    assert.equal(c.prepare("SELECT COUNT(*) AS count FROM admin_role_permissions WHERE role_id='owner'").get().count, 4);
    assert.equal(c.prepare("SELECT COUNT(*) AS count FROM admin_role_permissions p JOIN admin_roles r ON r.id=p.role_id WHERE r.code='SITE_CONTENT_MANAGER'").get().count, 3);
    assert.equal(c.prepare("SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL").get().count, 23);
    assert.equal(c.prepare('PRAGMA integrity_check').get().integrity_check,'ok'); assert.deepEqual(c.prepare('PRAGMA foreign_key_check').all(),[]);
    c.close(); c=null;
    cpSync('prisma/migrations/20261014100000_site_pages_branding_navigation',path.join(schema,'migrations/20261014100000_site_pages_branding_navigation'),{recursive:true});deploy();c=new DatabaseSync(file);
    for(const [table,rows] of snapshot){const oldColumns=Object.keys(rows[0]);assert.deepEqual(c.prepare(`SELECT ${oldColumns.map(name=>`"${name}"`).join(',')} FROM "${table}"`).all(),rows,table);}
    const cmsTables=new Set(c.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    assert(cmsTables.has('site_navigation_items'));assert(cmsTables.has('site_pages'));assert(cmsTables.has('site_branding'));
    assert.equal(c.prepare("SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL").get().count,24);
    assert.equal(c.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(c.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {c?.close(); assert.equal(path.dirname(path.resolve(work)),root); rmSync(work,{recursive:true,force:true});}
});
