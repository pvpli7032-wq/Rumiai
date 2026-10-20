import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash, randomUUID} from 'node:crypto';
import {cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import path from 'node:path';

test('upgrade from production migration 20 through the latest schema preserves business rows and closed-account safeguards', () => {
  const root = path.resolve('artifacts'); mkdirSync(root, {recursive: true});
  const work = mkdtempSync(path.join(root, 'circle-migration-')), schema = path.join(work, 'prisma'), file = path.join(work, 'source.db');
  mkdirSync(path.join(schema, 'migrations'), {recursive: true});
  for (const entry of readdirSync('prisma/migrations', {withFileTypes: true})) {
    if (entry.isDirectory() && entry.name >= '20261014070000_circle_management') continue;
    if (entry.isDirectory()) cpSync(path.join('prisma/migrations', entry.name), path.join(schema, 'migrations', entry.name), {recursive: true});
    else copyFileSync(path.join('prisma/migrations', entry.name), path.join(schema, 'migrations', entry.name));
  }
  // 本机 Prisma schema engine 不可用（同 scripts/helpers/create-isolated-db.mjs 先例）：
  // 迁移文件本身就是普通 SQLite SQL，用 node:sqlite 按序执行并补记 _prisma_migrations，
  // 断言口径（迁移计数、完整性、外键检查）保持不变。
  const deploy = () => {
    const c = new DatabaseSync(file);
    // 与 Prisma migrate deploy 同口径：迁移期间关闭外键强制，避免重建表时
    // ON DELETE CASCADE 误删业务行（迁移脚本内的事务中该 PRAGMA 是 no-op）。
    c.exec('PRAGMA foreign_keys = OFF');
    c.exec(`CREATE TABLE IF NOT EXISTS _prisma_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      finished_at DATETIME,
      migration_name TEXT NOT NULL,
      logs TEXT,
      rolled_back_at DATETIME,
      started_at DATETIME NOT NULL DEFAULT current_timestamp,
      applied_steps_count INTEGER NOT NULL DEFAULT 0
    )`);
    const done = new Set(c.prepare('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL').all().map(row => row.migration_name));
    const record = c.prepare('INSERT INTO _prisma_migrations (id, checksum, started_at, finished_at, migration_name, applied_steps_count) VALUES (?, ?, ?, ?, ?, 1)');
    for (const name of readdirSync(path.join(schema, 'migrations')).sort()) {
      const sqlPath = path.join(schema, 'migrations', name, 'migration.sql');
      if (!existsSync(sqlPath) || done.has(name)) continue;
      const sql = readFileSync(sqlPath, 'utf8');
      c.exec('BEGIN');
      try {
        c.exec(sql);
        const now = Date.now();
        record.run(randomUUID(), createHash('sha256').update(sql).digest('hex'), now, now, name);
        c.exec('COMMIT');
      } catch (error) {
        c.exec('ROLLBACK');
        c.close();
        throw new Error(`迁移失败：${name}\n${error.message}`);
      }
    }
    c.close();
  };
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
