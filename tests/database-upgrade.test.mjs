import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {cpSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

test('upgrade from production migration 20 through the latest schema preserves business rows and closed-account safeguards', () => {
  const root = path.resolve('artifacts'); mkdirSync(root, {recursive: true});
  const work = mkdtempSync(path.join(root, 'circle-migration-')), schema = path.join(work, 'prisma'), file = path.join(work, 'source.db');
  mkdirSync(path.join(schema, 'migrations'), {recursive: true}); copyFileSync('prisma/schema.prisma', path.join(schema, 'schema.prisma'));
  for (const entry of readdirSync('prisma/migrations', {withFileTypes: true})) {
    if (entry.isDirectory() && entry.name >= '20261014070000_circle_management') continue;
    if (entry.isDirectory()) cpSync(path.join('prisma/migrations', entry.name), path.join(schema, 'migrations', entry.name), {recursive: true});
    else copyFileSync(path.join('prisma/migrations', entry.name), path.join(schema, 'migrations', entry.name));
  }
  const env = {...process.env, DATABASE_URL: 'file:' + file.split(path.sep).join('/')}; delete env.RUST_LOG;
  const deploy = () => {const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', path.join(schema, 'schema.prisma')], {env, encoding: 'utf8', windowsHide: true}); assert.equal(result.status, 0, result.stdout + result.stderr);};
  let c;
  try {
    deploy(); c = new DatabaseSync(file); const now = Date.now();
    c.prepare('INSERT INTO users(id,username,email,password_hash,updated_at) VALUES(?,?,?,?,?)').run('author', 'author', 'author@example.invalid', 'synthetic-only', now);
    c.prepare('INSERT INTO characters(id,name,personality,background,creator_id,updated_at) VALUES(?,?,?,?,?,?)').run('retained-character','保留角色','合成人设','合成背景','author',now);
    c.prepare('INSERT INTO circles(id,name,description,owner_id,updated_at) VALUES(?,?,?,?,?)').run('circle', '保留圈子', '合成介绍', 'author', now);
    c.prepare('INSERT INTO circle_members(circle_id,user_id) VALUES(?,?)').run('circle', 'author');
    c.prepare('INSERT INTO posts(id,circle_id,author_id,content,updated_at) VALUES(?,?,?,?,?)').run('post', 'circle', 'author', '保留帖子', now);
    c.prepare('INSERT INTO post_media(id,post_id,url) VALUES(?,?,?)').run('media', 'post', '/uploads/synthetic.png');
    c.prepare('INSERT INTO post_comments(id,post_id,author_id,content,updated_at) VALUES(?,?,?,?,?)').run('comment', 'post', 'author', '保留评论', now);
    c.prepare('INSERT INTO post_likes(post_id,user_id) VALUES(?,?)').run('post', 'author');
    c.prepare('INSERT INTO admin_roles(id,code,name,system,updated_at) VALUES(?,?,?,?,?)').run('custom', 'CUSTOM', '自定义角色', 0, now);
    c.prepare('INSERT INTO admin_role_permissions(role_id,permission) VALUES(?,?)').run('custom', 'finance.read');
    c.prepare('INSERT INTO admin_roles(id,code,name,system,updated_at) VALUES(?,?,?,?,?)').run('existing_owner', 'OWNER', '原有所有者', 1, now);
    const originalOwnerGrants = ['admin.staff.read', 'admin.staff.manage', 'admin.roles.manage', 'admin.audit.read', 'accounts.read', 'accounts.manage', 'accounts.sessions.revoke', 'accounts.community.manage', 'characters.read', 'characters.write', 'characters.publish', 'moderation.read', 'moderation.write', 'finance.read', 'finance.packages.write', 'finance.refunds.request', 'finance.refunds.approve', 'finance.refunds.execute'];
    for (const permission of originalOwnerGrants) c.prepare('INSERT INTO admin_role_permissions(role_id,permission) VALUES(?,?)').run('existing_owner', permission);
    c.prepare('INSERT INTO admin_roles(id,code,name,system,updated_at) VALUES(?,?,?,?,?)').run('existing_community_manager', 'COMMUNITY_MANAGER', '原有社区管理员', 1, now);
    c.prepare('INSERT INTO admin_role_permissions(role_id,permission) VALUES(?,?)').run('existing_community_manager', 'community.read');
    c.prepare('INSERT INTO admin_roles(id,code,name,system,updated_at) VALUES(?,?,?,?,?)').run('existing_finance_manager', 'FINANCE_MANAGER', '原有财务管理员', 1, now);
    for (const permission of ['finance.read', 'finance.refunds.request']) c.prepare('INSERT INTO admin_role_permissions(role_id,permission) VALUES(?,?)').run('existing_finance_manager', permission);
    const tables = ['users', 'characters', 'circles', 'circle_members', 'posts', 'post_media', 'post_comments', 'post_likes', 'admin_roles'];
    const before = new Map(tables.map(table => [table, {columns: c.prepare('PRAGMA table_info("' + table + '")').all().map(row => row.name), rows: c.prepare('SELECT * FROM "' + table + '"').all()}]));
    const originalTriggers = c.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(row => row.name).sort();
    c.close(); c = null;
    cpSync('prisma/migrations/20261014070000_circle_management', path.join(schema, 'migrations/20261014070000_circle_management'), {recursive: true}); deploy(); c = new DatabaseSync(file);
    for (const [table, snapshot] of before) assert.deepEqual(c.prepare('SELECT ' + snapshot.columns.map(column => '"' + column + '"').join(',') + ' FROM "' + table + '"').all(), snapshot.rows, table);
    assert.equal(c.prepare('SELECT is_featured FROM circles').get().is_featured, 0);
    assert.deepEqual(c.prepare("SELECT permission FROM admin_role_permissions WHERE role_id='custom'").all().map(row => row.permission), ['finance.read']);
    assert.equal(c.prepare("SELECT COUNT(*) AS total FROM admin_role_permissions WHERE role_id='existing_owner'").get().total, 21);
    assert.equal(c.prepare("SELECT COUNT(*) AS total FROM admin_role_permissions WHERE role_id='existing_community_manager'").get().total, 5);
    assert.deepEqual(c.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(row => row.name).sort(), originalTriggers);
    assert.equal(c.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.deepEqual(c.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(c.prepare('SELECT COUNT(*) AS total FROM _prisma_migrations WHERE finished_at IS NOT NULL').get().total, 21);

    c.close(); c = null;
    for (const entry of readdirSync('prisma/migrations', {withFileTypes: true})) {
      if (entry.isDirectory() && entry.name >= '20261014080000_post_management') {
        cpSync(path.join('prisma/migrations', entry.name), path.join(schema, 'migrations', entry.name), {recursive: true});
      }
    }
    const expectedMigrationCount = readdirSync(path.join(schema, 'migrations'), {withFileTypes: true}).filter(entry => entry.isDirectory()).length;
    deploy(); c = new DatabaseSync(file);
    const primaryKeys = {
      users: ['id'], characters:['id'], circles: ['id'], circle_members: ['circle_id', 'user_id'], posts: ['id'],
      post_media: ['id'], post_comments: ['id'], post_likes: ['post_id', 'user_id'], admin_roles: ['id'],
    };
    for (const [table, snapshot] of before) {
      const keys = primaryKeys[table];
      const where = keys.map(column => `"${column}"=?`).join(' AND ');
      for (const row of snapshot.rows) {
        const columns = table === 'admin_roles' && row.code === 'FINANCE_MANAGER'
          ? snapshot.columns.filter(column => !['name', 'updated_at'].includes(column))
          : snapshot.columns;
        const current = c.prepare(`SELECT ${columns.map(column => `"${column}"`).join(',')} FROM "${table}" WHERE ${where}`)
          .get(...keys.map(column => row[column]));
        assert.deepEqual(Object.fromEntries(Object.entries(current)), Object.fromEntries(columns.map(column => [column, row[column]])), `${table} ${keys.map(column => row[column]).join('/')}`);
      }
    }
    assert.equal(c.prepare("SELECT name FROM admin_roles WHERE id='existing_finance_manager'").get().name, '财务经办员');
    assert.equal(c.prepare("SELECT COUNT(*) AS total FROM admin_role_permissions WHERE role_id='existing_finance_manager' AND permission='finance.refunds.request'").get().total, 1);
    for (const permission of ['finance.refunds.request', 'finance.refunds.approve']) {
      assert.equal(c.prepare('SELECT COUNT(*) AS total FROM admin_role_permissions WHERE role_id=? AND permission=?').get('existing_owner', permission).total, 1);
    }
    assert.equal(c.prepare('SELECT COUNT(*) AS total FROM _prisma_migrations WHERE finished_at IS NOT NULL').get().total, expectedMigrationCount);
    assert.deepEqual({...c.prepare('SELECT ai_models_restricted, ai_model_scope_version FROM characters WHERE id=?').get('retained-character')},{ai_models_restricted:0,ai_model_scope_version:0});
    assert.equal(c.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(c.prepare('PRAGMA foreign_key_check').all(), []);
    c.prepare('UPDATE users SET deleted_at=? WHERE id=?').run(now, 'author');
    assert.throws(() => c.prepare('INSERT INTO circles(id,name,description,owner_id,updated_at) VALUES(?,?,?,?,?)').run('late', '不允许', '不允许', 'author', now), /ACCOUNT_CLOSED/);
    assert.throws(() => c.prepare('UPDATE circles SET description=? WHERE id=?').run('不能复活', 'circle'), /ACCOUNT_CLOSED/);
    c.prepare('INSERT INTO circles(id,name,description,updated_at) VALUES(?,?,?,?)').run('site', '站点圈子', '站点内容', now);
    assert.equal(c.prepare("SELECT owner_id FROM circles WHERE id='site'").get().owner_id, null);
  } finally {c?.close(); assert.equal(path.dirname(path.resolve(work)), root); rmSync(work, {recursive: true, force: true});}
});
