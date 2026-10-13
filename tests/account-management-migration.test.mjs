import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {cpSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {PrismaClient} from '@prisma/client';
import {PERMISSIONS} from '../src/lib/admin/permissions.ts';

test('ordered account migration preserves existing data/custom grants and adds owner capabilities', async () => {
  const artifactRoot = path.resolve('artifacts'); mkdirSync(artifactRoot, {recursive: true});
  const work = mkdtempSync(path.join(artifactRoot, 'accounts-migration-'));
  assert.equal(path.dirname(work), artifactRoot);
  const schema = path.join(work, 'prisma'); mkdirSync(path.join(schema, 'migrations'), {recursive: true});
  copyFileSync('prisma/schema.prisma', path.join(schema, 'schema.prisma'));
  for (const entry of readdirSync('prisma/migrations', {withFileTypes: true})) {
    if (entry.isDirectory() && entry.name >= '20261013050000_account_management') continue;
    if (entry.isDirectory()) cpSync(path.join('prisma/migrations', entry.name), path.join(schema, 'migrations', entry.name), {recursive: true});
    else copyFileSync(path.join('prisma/migrations', entry.name), path.join(schema, 'migrations', entry.name));
  }
  const file = path.join(work, 'existing.db'), url = `file:${file.split(path.sep).join('/')}`;
  const env = {...process.env, DATABASE_URL: url}; delete env.RUST_LOG;
  const deploy = () => {
    const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', path.join(schema, 'schema.prisma')], {env, encoding: 'utf8', windowsHide: true});
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  let sqlite, client;
  try {
    deploy(); sqlite = new DatabaseSync(file);
    const now = Date.now();
    sqlite.prepare('INSERT INTO users (id, username, email, password_hash, coins, token_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('fixture_owner', 'fixture_owner', 'owner@example.invalid', 'synthetic-hash', 456, 3, now);
    const createRole = sqlite.prepare('INSERT INTO admin_roles (id, code, name, system, updated_at) VALUES (?, ?, ?, ?, ?)');
    createRole.run('fixture_owner_role', 'OWNER', '所有者', 1, now); createRole.run('fixture_custom_role', 'CUSTOM_LOCAL', '原有角色', 0, now);
    const grant = sqlite.prepare('INSERT INTO admin_role_permissions (role_id, permission) VALUES (?, ?)');
    for (const permission of Object.keys(PERMISSIONS).filter(key => !key.startsWith('accounts.') && !key.startsWith('characters.'))) grant.run('fixture_owner_role', permission);
    grant.run('fixture_custom_role', 'finance.read');
    sqlite.prepare('INSERT INTO admin_operators (user_id, enabled, version, updated_at) VALUES (?, 1, 7, ?)').run('fixture_owner', now);
    sqlite.prepare('INSERT INTO admin_role_assignments (user_id, role_id) VALUES (?, ?)').run('fixture_owner', 'fixture_owner_role');
    const fields = sqlite.prepare('PRAGMA table_info(users)').all().map(row => row.name);
    const beforeUser = sqlite.prepare('SELECT ' + fields.map(name => '"' + name + '"').join(',') + ' FROM users').all();
    const beforeOperator = sqlite.prepare('SELECT * FROM admin_operators').all();
    const beforeCustom = sqlite.prepare("SELECT * FROM admin_role_permissions WHERE role_id='fixture_custom_role'").all();
    sqlite.close(); sqlite = null;
    cpSync('prisma/migrations/20261013050000_account_management', path.join(schema, 'migrations/20261013050000_account_management'), {recursive: true});
    deploy(); sqlite = new DatabaseSync(file);
    assert.deepEqual(sqlite.prepare('SELECT ' + fields.map(name => '"' + name + '"').join(',') + ' FROM users').all(), beforeUser);
    assert.deepEqual(sqlite.prepare('SELECT * FROM admin_operators').all(), beforeOperator);
    assert.deepEqual(sqlite.prepare("SELECT * FROM admin_role_permissions WHERE role_id='fixture_custom_role'").all(), beforeCustom);
    assert.equal(sqlite.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM _prisma_migrations WHERE finished_at IS NOT NULL').get().total, 18);
    client = new PrismaClient({datasources: {db: {url}}, log: []});
    const user = await client.user.findUnique({where: {id: 'fixture_owner'}, select: {coins: true, tokenVersion: true, accountVersion: true, suspendedAt: true, lastLoginAt: true, lastActiveAt: true}});
    assert.deepEqual(user, {coins: 456, tokenVersion: 3, accountVersion: 0, suspendedAt: null, lastLoginAt: null, lastActiveAt: null});
    assert.equal(await client.adminRolePermission.count({where: {roleId: 'fixture_owner_role'}}), 13);
    const support = await client.adminRole.findUnique({where: {code: 'SUPPORT_AGENT'}, include: {permissions: true}});
    assert(support.system); assert.deepEqual(support.permissions.map(item => item.permission).sort(), ['accounts.community.manage', 'accounts.read']);
    deploy(); assert.equal(await client.adminRolePermission.count({where: {roleId: 'fixture_owner_role'}}), 13);
    // A valid pre-upgrade bootstrap can already contain the new system role.
    sqlite.prepare('INSERT INTO characters (id, name, personality, background, creator_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('fixture_character', '保留角色', 'SYNTHETIC_PERSONA', '合成背景', 'fixture_owner', now);
    sqlite.prepare('INSERT INTO admin_roles (id, code, name, system, updated_at) VALUES (?, ?, ?, ?, ?)').run('preexisting_character_manager', 'CHARACTER_MANAGER', '角色管理员', 1, now);
    sqlite.prepare('INSERT INTO admin_role_permissions (role_id, permission) VALUES (?, ?)').run('preexisting_character_manager', 'characters.read');
    sqlite.prepare('INSERT INTO admin_role_permissions (role_id, permission) VALUES (?, ?)').run('fixture_owner_role', 'characters.read');
    const beforeCharacter = sqlite.prepare("SELECT * FROM characters WHERE id='fixture_character'").get();
    cpSync('prisma/migrations/20261013060000_character_management', path.join(schema, 'migrations/20261013060000_character_management'), {recursive: true});
    deploy();
    assert.deepEqual(sqlite.prepare("SELECT * FROM characters WHERE id='fixture_character'").get(), beforeCharacter);
    assert.deepEqual(sqlite.prepare('SELECT ' + fields.map(name => '"' + name + '"').join(',') + ' FROM users').all(), beforeUser);
    assert.deepEqual(sqlite.prepare("SELECT * FROM admin_role_permissions WHERE role_id='fixture_custom_role'").all(), beforeCustom);
    assert.equal(await client.adminRolePermission.count({where: {roleId: 'fixture_owner_role'}}), 16);
    const characterManager = await client.adminRole.findUnique({where: {code: 'CHARACTER_MANAGER'}, include: {permissions: true}});
    assert.equal(characterManager.id, 'preexisting_character_manager'); assert.equal(characterManager.permissions.length, 3);
    assert(sqlite.prepare("PRAGMA index_list('characters')").all().some(index => index.name === 'characters_review_status_updated_at_id_idx'));
    sqlite.prepare('INSERT INTO upload_assets (id, owner_id, url) VALUES (?, ?, ?)').run('fixture_upload', 'fixture_owner', '/uploads/synthetic-migration.png');
    const uploadFields = sqlite.prepare('PRAGMA table_info(upload_assets)').all().map(row => row.name);
    const uploadProjection = uploadFields.map(name => '"' + name + '"').join(',');
    const beforeUpload = sqlite.prepare('SELECT ' + uploadProjection + ' FROM upload_assets').all();
    cpSync('prisma/migrations/20261014060000_site_owned_character_assets', path.join(schema, 'migrations/20261014060000_site_owned_character_assets'), {recursive: true});
    deploy();
    assert.deepEqual(sqlite.prepare('SELECT ' + uploadProjection + ' FROM upload_assets').all(), beforeUpload);
    assert.deepEqual(sqlite.prepare("SELECT * FROM characters WHERE id='fixture_character'").get(), beforeCharacter);
    assert.deepEqual(sqlite.prepare("SELECT * FROM admin_role_permissions WHERE role_id='fixture_custom_role'").all(), beforeCustom);
    assert.equal((await client.uploadAsset.findUnique({where: {id: 'fixture_upload'}, select: {siteOwned: true}})).siteOwned, false);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM _prisma_migrations WHERE finished_at IS NOT NULL').get().total, 20);
    assert.equal(sqlite.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {await client?.$disconnect(); sqlite?.close(); assert.equal(path.dirname(path.resolve(work)), artifactRoot); rmSync(work, {recursive: true, force: true});}
});
