import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import {rm, rmdir, readFile, stat} from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import path from 'node:path';

const file = `character-management-${process.pid}-${Date.now()}.db`, uploadRoot = path.resolve('artifacts', 'character-management', file, 'uploads');
process.env.DATABASE_URL = `file:./${file}`; process.env.JWT_SECRET = randomUUID() + randomUUID(); process.env.UPLOADS_DIRECTORY = uploadRoot;
process.env.MODERATOR_USER_IDS = ''; process.env.PAYMENT_ADMIN_USER_IDS = '';
const env = {...process.env}; delete env.RUST_LOG;
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true}); assert.equal(migration.status, 0, migration.stdout + migration.stderr);
const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {bootstrapOwner, saveOperator, saveRole} = await import('../src/lib/admin/management-service.ts');
const {listManagedCharacters, readManagedCharacter, saveManagedCharacter, publishManagedCharacter, publishManagedCharacters} = await import('../src/lib/characters/management-service.ts');
const {createCreatorCharacter, updateCreatorCharacter, deleteCreatorCharacter} = await import('../src/lib/characters/creator-service.ts');
const {listCharacters, readPublicCharacter, resolveCharacterTagLabels, listPublicCharacterPosts} = await import('../src/lib/characters/catalog-service.ts');
const {likeCharacter, unlikeCharacter, bookmarkCharacter, unbookmarkCharacter} = await import('../src/lib/characters/engagement-service.ts');
const {createCharacterComment, listCharacterComments, updateCharacterComment, deleteCharacterComment, likeCharacterComment, unlikeCharacterComment} = await import('../src/lib/characters/comment-service.ts');
const {GET: publicList, POST: createCharacterRoute} = await import('../src/app/api/characters/route.ts');
const {GET: publicDetail} = await import('../src/app/api/characters/[id]/route.ts');
const {GET: listCommentsRoute, POST: createCommentRoute} = await import('../src/app/api/characters/[id]/comments/route.ts');
const {GET: managementList} = await import('../src/app/api/admin/characters/route.ts');
const {signToken} = await import('../src/lib/auth.ts');
const {saveAccountUpload} = await import('../src/lib/uploads/storage-service.ts');
const {readVisibleUpload, mayAttachAccountUpload} = await import('../src/lib/uploads/read-service.ts');
const {closeAccount} = await import('../src/lib/accounts/closure-service.ts');
const {exportAccountData} = await import('../src/lib/accounts/data-export.ts');
const users = [];
for (const name of ['owner', 'editor', 'publisher', 'reader', 'author', 'ordinary']) users.push(await db.user.create({data: {username: name, email: `${name}@example.invalid`, passwordHash: 'synthetic-only'}}));
const [owner, editor, publisher, reader, author, ordinary] = users;
await bootstrapOwner(owner.email);
for (const [user, permissions] of [[editor, ['characters.read', 'characters.write']], [publisher, ['characters.read', 'characters.publish']], [reader, ['characters.read']]]) {
  const role = await saveRole(owner.id, {name: user.username, permissions, reason: '角色权限验收'});
  await saveOperator(owner.id, {userId: user.id, roleIds: [role.id], enabled: true, version: 0, reason: '角色权限验收'});
}
const request = async user => new Request('http://localhost/api/admin/characters', {headers: user ? {Authorization: `Bearer ${await signToken({userId: user.id, email: user.email})}`} : {}});
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
  const authorPrivate = await db.character.create({data: {creatorId: editor.id, name: '作者私有角色', personality: 'OWNER_PERSONA', background: ''}});
  const ownerResponse = await publicDetail(await request(editor), {params: Promise.resolve({id: authorPrivate.id})}); assert.equal(ownerResponse.status, 200);
  assert.equal((await ownerResponse.json()).character.personality, 'OWNER_PERSONA');
  const list = await managementList(await request(reader)); assert.equal(list.status, 200); assert.match(list.headers.get('cache-control'), /private, no-store/);
  assert(!(JSON.stringify(await list.json())).includes('PRIVATE_PERSONA'));
});
test('creator creation and catalog filters stay in the character domain with public review gating', async () => {
  const created = await createCharacterRoute(new Request('http://localhost/api/characters', {
    method: 'POST', headers: {Authorization: `Bearer ${await signToken({userId: author.id, email: author.email})}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({name: '投稿测试角色', personality: '合成设定', is_public: true, copyrightStatement: '合成原创声明', avatar_url: '/brand/icon.svg', initial_romance: 1500}),
  }));
  assert.equal(created.status, 201);
  const {character} = await created.json();
  assert.equal(character.creatorId, author.id);
  assert.equal(character.isPublic, false);
  assert.equal(character.publicationRequested, true);
  assert.equal(character.reviewStatus, 'PENDING');
  assert.equal(character.initialRomance, 1500);
  await assert.rejects(() => createCreatorCharacter(author.id, {name: '无版权申请', personality: '合成', isPublic: true}), error => error.status === 400);
  const mine = await listCharacters({scope: 'mine', userId: author.id});
  assert(mine.some(item => item.id === character.id && item.openReportCount === 0));
  const publicCatalog = await listCharacters({});
  assert(!publicCatalog.some(item => item.id === character.id));
});
test('public character page data is projected by the character domain and excludes hidden community content', async () => {
  await db.tag.create({data: {key: 'public-tag', label: '公开标签', group: 'GENRE'}});
  const role = await db.character.create({data: {creatorId: author.id, name: '网页公开角色', personality: '合成', background: '', tags: 'public-tag,unknown-tag', isPublic: true, reviewStatus: 'APPROVED'}});
  const circle = await db.circle.create({data: {name: '公开角色圈子', description: '合成'}});
  const visible = await db.post.create({data: {circleId: circle.id, authorId: author.id, characterId: role.id, content: '公开关联帖子'}});
  await db.post.create({data: {circleId: circle.id, authorId: author.id, characterId: role.id, content: '已隐藏帖子', status: 'HIDDEN'}});
  assert.equal((await readPublicCharacter(role.id)).id, role.id);
  assert.deepEqual(await resolveCharacterTagLabels(role.tags), ['公开标签', 'unknown-tag']);
  assert.deepEqual((await listPublicCharacterPosts(role.id)).map(post => post.id), [visible.id]);
  await db.character.update({where: {id: role.id}, data: {isPublic: false}});
  assert.equal(await readPublicCharacter(role.id), null);
});
test('creator edits and deletion are owned by the character domain and enforce author boundaries', async () => {
  const role = await db.character.create({data: {creatorId: author.id, name: '作者角色', personality: '原本人设', background: ''}});
  await assert.rejects(() => updateCreatorCharacter(ordinary.id, role.id, {name: '越权修改'}), error => error.status === 403);
  const edited = await updateCreatorCharacter(author.id, role.id, {name: '修改后的角色', isPublic: true, copyrightStatement: '合成原创声明'});
  assert.equal(edited.name, '修改后的角色');
  assert.equal(edited.isPublic, false);
  assert.equal(edited.publicationRequested, true);
  assert.equal(edited.reviewStatus, 'PENDING');
  await assert.rejects(() => deleteCreatorCharacter(ordinary.id, role.id), error => error.status === 403);
  assert.ok(await db.character.findUnique({where: {id: role.id}}));
  assert.deepEqual(await deleteCreatorCharacter(author.id, role.id), {success: true});
  assert.equal(await db.character.findUnique({where: {id: role.id}}), null);
});
test('character likes and bookmarks preserve privacy, uniqueness and counter consistency', async () => {
  const role = await db.character.create({data: {creatorId: author.id, name: '互动测试角色', personality: '合成内容', background: ''}});
  await denied(() => likeCharacter(ordinary.id, role.id), 403);
  await denied(() => bookmarkCharacter(ordinary.id, role.id), 403);
  await db.character.update({where: {id: role.id}, data: {isPublic: true, reviewStatus: 'APPROVED'}});

  const parallelLikes = await Promise.all([likeCharacter(reader.id, role.id), likeCharacter(reader.id, role.id)]);
  assert.deepEqual(parallelLikes.map(result => result.likeCount), [1, 1]);
  assert.equal(await db.characterLike.count({where: {userId: reader.id, characterId: role.id}}), 1);
  assert.equal((await db.character.findUnique({where: {id: role.id}})).likeCount, 1);
  await bookmarkCharacter(reader.id, role.id);
  await bookmarkCharacter(reader.id, role.id);
  assert.equal(await db.characterBookmark.count({where: {userId: reader.id, characterId: role.id}}), 1);
  assert.equal((await unlikeCharacter(reader.id, role.id)).likeCount, 0);
  assert.equal((await unlikeCharacter(reader.id, role.id)).likeCount, 0);
  await unbookmarkCharacter(reader.id, role.id);
  await unbookmarkCharacter(reader.id, role.id);
  assert.equal(await db.characterBookmark.count({where: {userId: reader.id, characterId: role.id}}), 0);
});
test('character comments keep visibility, one-level replies, hidden filtering and HTTP ownership in the character domain', async () => {
  const role = await db.character.create({data: {creatorId: author.id, name: '评论域测试角色', personality: '合成内容', background: ''}});
  await denied(() => listCharacterComments(role.id, ordinary.id), 403);
  await denied(() => createCharacterComment(author.id, role.id, {body: '   '}), 400);
  await db.character.update({where: {id: role.id}, data: {isPublic: true, reviewStatus: 'APPROVED'}});

  const root = await createCharacterComment(author.id, role.id, {body: ' 根评论 '});
  const reply = await createCharacterComment(reader.id, role.id, {body: '回复根评论', parent_id: root.comment.id});
  const nested = await createCharacterComment(reader.id, role.id, {body: '回复仍归根评论', parentId: reply.comment.id});
  assert.equal(root.comment.body, '根评论');
  assert.equal(nested.comment.parentId, root.comment.id);
  await db.comment.update({where: {id: nested.comment.id}, data: {hiddenAt: new Date()}});
  const visible = await listCharacterComments(role.id, undefined);
  assert.equal(visible.comments.length, 1);
  assert.equal(visible.comments[0].replyCount, 2);
  assert.deepEqual(visible.comments[0].replies.map(item => item.id), [reply.comment.id]);
  await denied(() => updateCharacterComment(reader.id, root.comment.id, {body: '他人评论'}), 403);
  assert.equal((await updateCharacterComment(author.id, root.comment.id, {body: '编辑后的根评论'})).body, '编辑后的根评论');
  const parallelLikes = await Promise.all(Array.from({length: 6}, () => likeCharacterComment(reader.id, root.comment.id)));
  assert(parallelLikes.every(result => result.likeCount === 1));
  assert.equal(await db.commentLike.count({where: {userId: reader.id, commentId: root.comment.id}}), 1);
  assert.equal((await unlikeCharacterComment(reader.id, root.comment.id)).likeCount, 0);
  await denied(() => deleteCharacterComment(ordinary.id, reply.comment.id), 403);
  assert.deepEqual(await deleteCharacterComment(author.id, nested.comment.id), {success: true, deletedBy: 'creator'});

  const anonymousPost = await createCommentRoute(new Request('http://localhost/api/characters/comments', {method: 'POST'}), {params: Promise.resolve({id: role.id})});
  assert.equal(anonymousPost.status, 401);
  const token = await signToken({userId: reader.id, email: reader.email});
  const created = await createCommentRoute(new Request('http://localhost/api/characters/comments', {
    method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({body: '通过 HTTP 入口创建'}),
  }), {params: Promise.resolve({id: role.id})});
  assert.equal(created.status, 201);
  const listing = await listCommentsRoute(new Request('http://localhost/api/characters/comments'), {params: Promise.resolve({id: role.id})});
  assert.equal(listing.status, 200);
  assert.equal((await listing.json()).comments.length, 2);
});
test('editing and publication are distinct permissions with enforced read dependencies', async () => {
  const role = await create();
  await denied(() => publish(editor, role), 403);
  await denied(() => saveManagedCharacter(publisher.id, role.id, {updatedAt: role.updatedAt.toISOString(), content: {name: '不允许编辑'}, reason: '测试'}), 403);
  await denied(() => create(reader), 403);
  await denied(() => saveRole(owner.id, {name: '错误配置', permissions: ['characters.write'], reason: '测试'}), 400);
});
test('draft creation and content validation cannot bypass publication', async () => {
  const role = await create(editor, {copyrightStatement: ''}); assert.equal(role.reviewStatus, 'DRAFT'); assert.equal(role.isPublic, false); assert.equal(role.creatorId, null);
  await denied(() => publish(publisher, role), 400);
  for (const content of [{name: '', personality: '人设'}, {name: '非法', personality: '人设', avatarUrl: 'javascript:alert(1)'}, {name: '直接公开', personality: '人设', isPublic: true}]) await denied(() => saveManagedCharacter(editor.id, null, {content, reason: '无效内容'}), 400);
});
test('published edit withdraws visibility, preserves ownership and keeps counters and associations', async () => {
  const role = await create(editor, {copyrightStatement: '合成原创'}); const published = await publish(publisher, role);
  const conversation = await db.conversation.create({data: {userId: ordinary.id, characterId: role.id}});
  const edited = await saveManagedCharacter(editor.id, role.id, {updatedAt: published.updatedAt.toISOString(), content: {background: '修改后的合成背景'}, reason: '内容修订'});
  assert.equal(edited.reviewStatus, 'PENDING'); assert.equal(edited.isPublic, false); assert.equal(edited.creatorId, null); assert.equal(edited.chatCount, role.chatCount);
  assert.equal((await db.conversation.findUnique({where: {id: conversation.id}})).characterId, role.id);
  const visible = await (await publicList(new Request('http://localhost/api/characters'))).json(); assert(!visible.some(item => item.id === role.id));
  await denied(() => publish(publisher, published), 409);
  const restored = await publish(publisher, edited); assert(restored.isPublic);
  const down = await publish(publisher, restored, 'UNPUBLISH'); assert.equal(down.reviewStatus, 'REJECTED'); assert.equal(down.isPublic, false);
});
test('search, exact tag boundaries and all review statuses paginate stored records', async () => {
  for (let i = 0; i < 26; i++) await create(editor, {name: `分页_${i}`, tags: '猫,原创'});
  await create(editor, {name: '不应误匹配', tags: '猫娘'});
  const first = await listManagedCharacters(reader.id, {q: '分页_', tag: '猫', status: 'DRAFT', page: 1}), second = await listManagedCharacters(reader.id, {q: '分页_', tag: '猫', page: 2});
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

test('site assets survive staff departure and closure while personal assets are erased', async () => {
  const password = randomUUID();
  const staff = await db.user.create({data: {username: 'departing-staff', email: 'departing-staff@example.invalid', passwordHash: await bcrypt.hash(password, 10)}});
  const role = await saveRole(owner.id, {name: '离任素材验收', permissions: ['characters.read', 'characters.write'], reason: '合成角色'});
  await saveOperator(owner.id, {userId: staff.id, roleIds: [role.id], enabled: true, version: 0, reason: '合成员工'});
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  const site = await saveAccountUpload(staff.id, new File([pixel], 'site.png', {type: 'image/png'}));
  const personal = await saveAccountUpload(staff.id, new File([Buffer.concat([pixel, Buffer.from('synthetic-personal')])], 'personal.png', {type: 'image/png'}));
  for (const asset of [site, personal]) files.add(path.basename(asset.url));
  const character = await create(staff, {name: '站点保留角色', copyrightStatement: '合成原创', avatarUrl: site.url, images: [{url: site.url}]});
  const personalCharacter = await db.character.create({data: {creatorId: staff.id, name: '个人待注销角色', personality: '个人合成人设', background: '', avatarUrl: personal.url}});
  const editedPersonal = await saveManagedCharacter(owner.id, personalCharacter.id, {updatedAt: personalCharacter.updatedAt.toISOString(), content: {background: '管理员修订个人角色'}, reason: '保留个人作者归属'});
  assert.equal(editedPersonal.creatorId, staff.id);
  assert.equal(character.creatorId, null);
  assert.equal((await db.uploadAsset.findUnique({where: {url: site.url}})).siteOwned, true);
  assert.equal((await db.uploadAsset.findUnique({where: {url: personal.url}})).siteOwned, false);
  const exported = await exportAccountData(staff.id);
  assert(!exported.uploads.some(asset => asset.url === site.url)); assert(exported.uploads.some(asset => asset.url === personal.url));
  assert(!exported.characters.some(item => item.id === character.id));
  const operator = await db.adminOperator.findUnique({where: {userId: staff.id}});
  await saveOperator(owner.id, {userId: staff.id, roleIds: [role.id], enabled: false, version: operator.version, reason: '员工离任'});
  await denied(() => readVisibleUpload(path.basename(site.url), staff.id), 404);
  assert.equal(await mayAttachAccountUpload(staff.id, site.url), false);
  // A personal profile reference cannot publish a private site asset.
  await db.user.update({where: {id: staff.id}, data: {avatarUrl: site.url}});
  await denied(() => readVisibleUpload(path.basename(site.url), ordinary.id), 404);
  assert.deepEqual((await readVisibleUpload(path.basename(site.url), reader.id)).bytes, pixel);
  const closed = await closeAccount(staff.id, {password, confirmation: '注销我的账号', acknowledgeRetention: true});
  assert.equal(closed.fileCleanupPending, false);
  assert.deepEqual(await readFile(path.join(uploadRoot, path.basename(site.url))), pixel);
  await assert.rejects(stat(path.join(uploadRoot, path.basename(personal.url))), {code: 'ENOENT'});
  assert.equal((await db.character.findUnique({where: {id: personalCharacter.id}})).reviewStatus, 'DELETED');
  const retained = await db.character.findUnique({where: {id: character.id}});
  assert.equal(retained.reviewStatus, 'DRAFT'); assert.equal(retained.name, '站点保留角色');
  assert.deepEqual((await readVisibleUpload(path.basename(site.url), reader.id)).bytes, pixel);
  await denied(() => readVisibleUpload(path.basename(site.url), staff.id), 404);
  await publish(publisher, retained);
  assert.deepEqual((await readVisibleUpload(path.basename(site.url), null)).bytes, pixel);
});
