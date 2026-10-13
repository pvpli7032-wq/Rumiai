import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import {rm, rmdir} from 'node:fs/promises';
import path from 'node:path';

const file = `character-management-${process.pid}-${Date.now()}.db`, uploadRoot = path.resolve('artifacts', 'character-management', file, 'uploads');
process.env.DATABASE_URL = `file:./${file}`; process.env.JWT_SECRET = randomUUID() + randomUUID(); process.env.UPLOADS_DIRECTORY = uploadRoot;
process.env.MODERATOR_USER_IDS = ''; process.env.PAYMENT_ADMIN_USER_IDS = '';
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true}); assert.equal(migration.status, 0, migration.stdout + migration.stderr);
const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {bootstrapOwner, saveOperator, saveRole} = await import('../src/lib/admin/management-service.ts');
const {listManagedCharacters, readManagedCharacter, saveManagedCharacter, publishManagedCharacter, publishManagedCharacters} = await import('../src/lib/characters/management-service.ts');
const {GET: publicList} = await import('../src/app/api/characters/route.ts');
const {GET: publicDetail} = await import('../src/app/api/characters/[id]/route.ts');
const {GET: managementList} = await import('../src/app/api/characters/management/route.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {saveAccountUpload} = await import('../src/lib/uploads/storage-service.ts');
const {readVisibleUpload} = await import('../src/lib/uploads/read-service.ts');
const users = [];
for (const name of ['owner', 'editor', 'publisher', 'reader', 'author', 'ordinary']) users.push(await db.user.create({data: {username: name, email: `${name}@example.invalid`, passwordHash: 'synthetic-only'}}));
const [owner, editor, publisher, reader, author, ordinary] = users;
await bootstrapOwner(owner.email);
for (const [user, permissions] of [[editor, ['characters.read', 'characters.write']], [publisher, ['characters.read', 'characters.publish']], [reader, ['characters.read']]]) {
  const role = await saveRole(owner.id, {name: user.username, permissions, reason: '角色权限验收'});
  await saveOperator(owner.id, {userId: user.id, roleIds: [role.id], enabled: true, version: 0, reason: '角色权限验收'});
}
const request = async user => new Request('http://localhost/api/characters/management', {headers: user ? {Authorization: `Bearer ${await signToken({userId: user.id, email: user.email})}`} : {}});
const create = (actor = editor, content = {}) => saveManagedCharacter(actor.id, null, {content: {name: '管理角色', personality: 'PRIVATE_PERSONA', background: '合成背景', ...content}, reason: '创建合成角色'});
const publish = (actor, character, action = 'PUBLISH') => publishManagedCharacter(actor.id, character.id, {action, reason: '合成发布动作', updatedAt: character.updatedAt.toISOString()});
const denied = (fn, status) => assert.rejects(fn, error => error.status === status);
const files = new Set();
test.after(async () => {await db.$disconnect(); for (const name of files) await rm(path.join(uploadRoot, name), {force: true}); if (files.size) {await rmdir(uploadRoot); await rmdir(path.dirname(uploadRoot));} for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path.resolve('prisma', file + suffix), {force: true});});

test('management is private while the public endpoint still rejects private roles', async () => {
  assert.equal((await managementList(await request())).status, 401); assert.equal((await managementList(await request(ordinary))).status, 403);
  const role = await create();
  const managed = await readManagedCharacter(reader.id, role.id); assert.equal(managed.personality, 'PRIVATE_PERSONA');
  const response = await publicDetail(await request(ordinary), {params: Promise.resolve({id: role.id})}); assert.equal(response.status, 403);
  const list = await managementList(await request(reader)); assert.equal(list.status, 200); assert.match(list.headers.get('cache-control'), /private, no-store/);
  assert(!(JSON.stringify(await list.json())).includes('PRIVATE_PERSONA'));
});
test('editing and publication are distinct permissions with enforced read dependencies', async () => {
  const role = await create();
  await denied(() => publish(editor, role), 403);
  await denied(() => saveManagedCharacter(publisher.id, role.id, {updatedAt: role.updatedAt.toISOString(), content: {name: '不允许编辑'}, reason: '测试'}), 403);
  await denied(() => create(reader), 403);
  await denied(() => saveRole(owner.id, {name: '错误配置', permissions: ['characters.write'], reason: '测试'}), 400);
});
test('draft creation and content validation cannot bypass publication', async () => {
  const role = await create(editor, {copyrightStatement: ''}); assert.equal(role.reviewStatus, 'DRAFT'); assert.equal(role.isPublic, false); assert.equal(role.creatorId, editor.id);
  await denied(() => publish(publisher, role), 400);
  for (const content of [{name: '', personality: '人设'}, {name: '非法', personality: '人设', avatarUrl: 'javascript:alert(1)'}, {name: '直接公开', personality: '人设', isPublic: true}]) await denied(() => saveManagedCharacter(editor.id, null, {content, reason: '无效内容'}), 400);
});
test('published edit withdraws visibility, preserves ownership and keeps counters and associations', async () => {
  const role = await create(editor, {copyrightStatement: '合成原创'}); const published = await publish(publisher, role);
  const conversation = await db.conversation.create({data: {userId: ordinary.id, characterId: role.id}});
  const edited = await saveManagedCharacter(editor.id, role.id, {updatedAt: published.updatedAt.toISOString(), content: {background: '修改后的合成背景'}, reason: '内容修订'});
  assert.equal(edited.reviewStatus, 'PENDING'); assert.equal(edited.isPublic, false); assert.equal(edited.creatorId, editor.id); assert.equal(edited.chatCount, role.chatCount);
  assert.equal((await db.conversation.findUnique({where: {id: conversation.id}})).characterId, role.id);
  const visible = await (await publicList(new Request('http://localhost/api/characters'))).json(); assert(!visible.some(item => item.id === role.id));
  await denied(() => publish(publisher, published), 409);
  const restored = await publish(publisher, edited); assert(restored.isPublic);
  const down = await publish(publisher, restored, 'UNPUBLISH'); assert.equal(down.reviewStatus, 'REJECTED'); assert.equal(down.isPublic, false);
});
test('search, exact tag boundaries, ownership and all review statuses paginate stored records', async () => {
  for (let i = 0; i < 26; i++) await create(editor, {name: `分页_${i}`, tags: '猫,原创'});
  await create(editor, {name: '不应误匹配', tags: '猫娘'});
  const first = await listManagedCharacters(reader.id, {q: '分页_', tag: '猫', status: 'DRAFT', creatorId: editor.id, page: 1}), second = await listManagedCharacters(reader.id, {q: '分页_', tag: '猫', page: 2});
  assert.equal(first.total, 26); assert.equal(first.items.length, 25); assert.equal(second.items.length, 1); assert(!first.items.some(item => item.id === second.items[0].id));
  assert.equal((await listManagedCharacters(reader.id, {tag: '猫'})).total, 26);
  for (const params of [{status: 'INVALID'}, {page: NaN}, {creatorId: '..'}, {q: 'x'.repeat(101)}]) await denied(() => listManagedCharacters(reader.id, params), 400);
});
test('stale edits and batch invalidity roll back changes and sanitized audits', async () => {
  const roles = [await create(editor, {copyrightStatement: '合成原创'}), await create(editor, {copyrightStatement: ''})];
  const before = await db.adminAuditLog.count();
  await denied(() => publishManagedCharacters(publisher.id, {action: 'PUBLISH', reason: '整批验证', items: roles.map(role => ({id: role.id, updatedAt: role.updatedAt.toISOString()}))}), 400);
  assert.equal((await db.character.findUnique({where: {id: roles[0].id}})).isPublic, false); assert.equal(await db.adminAuditLog.count(), before);
  const edited = await saveManagedCharacter(editor.id, roles[0].id, {content: {tagline: '新版本'}, updatedAt: roles[0].updatedAt.toISOString(), reason: '版本修改'});
  await denied(() => saveManagedCharacter(editor.id, roles[0].id, {content: {name: '过期修改'}, updatedAt: roles[0].updatedAt.toISOString(), reason: '过期修改'}), 409);
  assert(edited.updatedAt > roles[0].updatedAt); assert(!JSON.stringify(await db.adminAuditLog.findMany()).includes('PRIVATE_PERSONA'));
});
test('batch publication and unpublication take effect as one transaction', async () => {
  const roles = [await create(editor, {copyrightStatement: '合成原创'}), await create(editor, {copyrightStatement: '合成原创'})];
  const up = await publishManagedCharacters(publisher.id, {action: 'PUBLISH', reason: '整批公开', items: roles.map(role => ({id: role.id, updatedAt: role.updatedAt.toISOString()}))}); assert(up.every(role => role.isPublic));
  const down = await publishManagedCharacters(publisher.id, {action: 'UNPUBLISH', reason: '整批下架', items: up.map(role => ({id: role.id, updatedAt: role.updatedAt.toISOString()}))}); assert(down.every(role => !role.isPublic));
});
test('private role image preview is scoped and does not grant access to unrelated chat attachments', async () => {
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  const asset = await saveAccountUpload(author.id, new File([pixel], 'pixel.png', {type: 'image/png'})); files.add(path.basename(asset.url));
  const attached = await db.character.create({data: {creatorId: author.id, name: '私有图片角色', personality: '合成人设', background: '', avatarUrl: asset.url}});
  assert.deepEqual((await readVisibleUpload(path.basename(asset.url), reader.id)).bytes, pixel);
  await assert.rejects(() => readVisibleUpload(path.basename(asset.url), ordinary.id), error => error.status === 404);
  await db.character.update({where: {id: attached.id}, data: {avatarUrl: null}});
  await assert.rejects(() => readVisibleUpload(path.basename(asset.url), reader.id), error => error.status === 404);
  const forged = await create(editor);
  await denied(() => saveManagedCharacter(editor.id, forged.id, {updatedAt: forged.updatedAt.toISOString(), content: {avatarUrl: asset.url}, reason: '外来附件'}), 400);
});
test('deleted characters cannot be restored, and suspended staff lose domain privileges', async () => {
  const role = await create(editor, {copyrightStatement: '合成原创'}); await db.character.update({where: {id: role.id}, data: {reviewStatus: 'DELETED'}});
  const deleted = await db.character.findUnique({where: {id: role.id}}); await denied(() => publish(publisher, deleted), 409);
  await denied(() => saveManagedCharacter(editor.id, role.id, {updatedAt: deleted.updatedAt.toISOString(), content: {name: '不能复活'}, reason: '测试'}), 409);
  await db.user.update({where: {id: editor.id}, data: {suspendedAt: new Date()}}); await denied(() => create(editor), 403);
});

test('structured galleries, emotional portraits and cast retain IDs and roll back invalid collections', async () => {
  const role = await create(owner, {name: '素材管理角色', copyrightStatement: '合成原创', tags: ' 原创, 猫,原创 ', relationshipStatus: '朋友', initialRomance: 1100, initialIntimacy: 10, images: [{url: '/brand/icon.svg', kind: 'IMAGE'}], emojis: [{emotion: 'happy', url: '/brand/icon.svg'}, {emotion: 'sad', url: '/brand/icon.svg'}], supportCast: [{name: '合成配角', description: '配角说明', avatarUrl: '/brand/icon.svg'}]});
  assert.equal(role.initialRomance, 1100); assert.equal(role.tags, '原创,猫');
  const detail = await readManagedCharacter(reader.id, role.id);
  const edited = await saveManagedCharacter(owner.id, role.id, {updatedAt: role.updatedAt.toISOString(), reason: '交换表情', content: {emojis: [{id: detail.emojis[0].id, emotion: 'sad', url: '/brand/icon.svg'}, {id: detail.emojis[1].id, emotion: 'happy', url: '/brand/icon.svg'}], supportCast: [{id: detail.supportCast[0].id, name: '修改配角', description: '修改说明', avatarUrl: '/brand/icon.svg'}]}});
  const after = await readManagedCharacter(reader.id, role.id); assert.equal(after.emojis[0].id, detail.emojis[0].id); assert.equal(after.emojis[0].emotion, 'sad'); assert.equal(after.supportCast[0].id, detail.supportCast[0].id);
  const other = await create(owner, {images: [{url: '/brand/icon.svg'}]}); const foreign = await readManagedCharacter(reader.id, other.id);
  for (const content of [{images: [{id: foreign.images[0].id, url: '/brand/icon.svg'}]}, {emojis: [{emotion: 'duplicate', url: '/brand/icon.svg'}, {emotion: 'duplicate', url: '/brand/icon.svg'}]}, {initialRomance: -1}, {initialIntimacy: 1000001}, {unexpectedSetting: 'ignored field'}]) await denied(() => saveManagedCharacter(owner.id, role.id, {updatedAt: edited.updatedAt.toISOString(), content, reason: '拒绝无效素材'}), 400);
  assert.equal((await db.character.findUnique({where: {id: role.id}})).updatedAt.getTime(), edited.updatedAt.getTime());
  assert.equal((await readManagedCharacter(reader.id, role.id)).emojis[0].emotion, 'sad');
});

test('system-owned roles can use the editor own uploads without exposing foreign attachments', async () => {
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  const asset = await saveAccountUpload(owner.id, new File([pixel], 'pixel.png', {type: 'image/png'})); files.add(path.basename(asset.url));
  const system = await db.character.create({data: {name: '系统素材角色', personality: '合成人设', background: '', copyrightStatement: '合成原创'}});
  const edited = await saveManagedCharacter(owner.id, system.id, {updatedAt: system.updatedAt.toISOString(), content: {avatarUrl: asset.url, images: [{url: asset.url}]}, reason: '配置系统素材'});
  assert.equal(edited.creatorId, null); assert.deepEqual((await readVisibleUpload(path.basename(asset.url), reader.id)).bytes, pixel);
  await publish(publisher, edited); assert.deepEqual((await readVisibleUpload(path.basename(asset.url), null)).bytes, pixel);
});
