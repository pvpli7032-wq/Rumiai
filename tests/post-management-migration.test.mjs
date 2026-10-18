import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {cpSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

test('post-management migration preserves existing community records and initializes moderation flags', () => {
  const root = path.resolve('artifacts'); mkdirSync(root, {recursive: true});
  const work = mkdtempSync(path.join(root, 'post-migration-')), schema = path.join(work, 'prisma'), file = path.join(work, 'source.db');
  mkdirSync(path.join(schema, 'migrations'), {recursive: true}); copyFileSync('prisma/schema.prisma', path.join(schema, 'schema.prisma'));
  for (const entry of readdirSync('prisma/migrations', {withFileTypes: true})) {
    if (!entry.isDirectory() || entry.name >= '20261014080000_post_management') continue;
    cpSync(path.join('prisma/migrations', entry.name), path.join(schema, 'migrations', entry.name), {recursive: true});
  }
  const env = {...process.env, DATABASE_URL: 'file:' + file.split(path.sep).join('/')}; delete env.RUST_LOG;
  const deploy = () => {const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', path.join(schema, 'schema.prisma')], {env, encoding: 'utf8', windowsHide: true}); assert.equal(result.status, 0, result.stdout + result.stderr);};
  let c;
  try {
    deploy(); c = new DatabaseSync(file); const now = Date.now();
    c.prepare('INSERT INTO users(id,username,email,password_hash,updated_at) VALUES(?,?,?,?,?)').run('author', 'author', 'author@example.invalid', 'synthetic-only', now);
    c.prepare('INSERT INTO circles(id,name,description,updated_at) VALUES(?,?,?,?)').run('circle', '保留圈子', 'synthetic', now);
    c.prepare('INSERT INTO circle_members(circle_id,user_id) VALUES(?,?)').run('circle', 'author');
    c.prepare('INSERT INTO posts(id,circle_id,author_id,content,updated_at) VALUES(?,?,?,?,?)').run('post', 'circle', 'author', '保留正文', now);
    c.prepare('INSERT INTO post_media(id,post_id,url) VALUES(?,?,?)').run('media', 'post', '/uploads/synthetic.png');
    c.prepare('INSERT INTO post_comments(id,post_id,author_id,content,updated_at) VALUES(?,?,?,?,?)').run('comment', 'post', 'author', '保留评论', now);
    c.prepare('INSERT INTO post_likes(post_id,user_id) VALUES(?,?)').run('post', 'author');
    const snapshot = Object.fromEntries(['posts', 'post_media', 'post_comments', 'post_likes'].map(table => [table, c.prepare(`SELECT * FROM ${table}`).all()]));
    c.close(); c = null;
    cpSync('prisma/migrations/20261014080000_post_management', path.join(schema, 'migrations/20261014080000_post_management'), {recursive: true}); deploy(); c = new DatabaseSync(file);
    for (const [table, rows] of Object.entries(snapshot)) {
      const names = Object.keys(rows[0]); assert.deepEqual(c.prepare(`SELECT ${names.map(name => `"${name}"`).join(',')} FROM "${table}"`).all(), rows, table);
    }
    const post = c.prepare("SELECT is_pinned,is_featured FROM posts WHERE id='post'").get(); assert.equal(post.is_pinned, 0); assert.equal(post.is_featured, 0);
    const indexes = c.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row => row.name);
    assert(indexes.includes('posts_circle_id_status_is_pinned_is_featured_created_at_id_idx'));
    assert.equal(c.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.deepEqual(c.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(c.prepare('SELECT COUNT(*) AS total FROM _prisma_migrations WHERE finished_at IS NOT NULL').get().total, 22);
  } finally {c?.close(); assert.equal(path.dirname(path.resolve(work)), root); rmSync(work, {recursive: true, force: true});}
});
