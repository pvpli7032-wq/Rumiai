import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir, open, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {chromium} from 'playwright';

const stamp = `${process.pid}-${Date.now()}`, file = `post-browser-${stamp}.db`, base = 'http://127.0.0.1:18802';
const out = path.resolve('artifacts/post-management-browser', stamp); await mkdir(out, {recursive: true});
const env = {...process.env, NODE_ENV: 'production', DATABASE_URL: `file:./${file}`, UPLOADS_DIRECTORY: path.join(out, 'uploads'), JWT_SECRET: randomBytes(48).toString('hex'), OPENAI_API_KEY: '', EZFP_ENABLED: 'false', EZFP_REFUNDS_ENABLED: 'false', DISABLE_MOCK_AI: 'true', ALLOW_SIMULATED_PURCHASES: 'false', MODERATOR_USER_IDS: '', PAYMENT_ADMIN_USER_IDS: '', NEXT_DIST_DIR: '.next-build', NEXT_PUBLIC_SITE_URL: base}; delete env.RUST_LOG;
Object.assign(process.env, env); const dbPath = path.resolve('prisma', file), empty = await open(dbPath, 'wx'); await empty.close();
const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true}); assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {bootstrapOwner, saveOperator} = await import('../src/lib/admin/management-service.ts');
const {createPost, createPostComment, managePost, managePostComment} = await import('../src/lib/posts/service.ts');
const {saveAccountUpload} = await import('../src/lib/uploads/storage-service.ts');
const password = randomBytes(24).toString('hex'), users = [], errors = [], checks = [];
let app, browser;
try {
  for (const username of ['owner', 'author', 'reader']) users.push(await db.user.create({data: {username: `${username}_${stamp}`, email: `${username}-${stamp}@example.invalid`, passwordHash: await bcrypt.hash(password, 10)}}));
  await bootstrapOwner(users[0].email);
  const moderationUser = await db.user.create({data: {username: `m3moderator_${stamp}`, email: 'm3-moderator@example.invalid', passwordHash: await bcrypt.hash('M3Moderator123!', 10)}});
  const moderatorRole = await db.adminRole.findUniqueOrThrow({where: {code: 'MODERATOR'}});
  await saveOperator(users[0].id, {userId: moderationUser.id, enabled: true, version: 0, roleIds: [moderatorRole.id], reason: '隔离测试审核员'});
  const circle = await db.circle.create({data: {name: '帖子管理验收圈', description: '合成页面验收', members: {create: users.slice(1).map(user => ({userId: user.id}))}}});
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  const upload = await saveAccountUpload(users[1].id, new File([png], 'post-preview.png', {type: 'image/png'}));
  const first = await createPost(users[1].id, circle.id, {content: '浏览器验收帖子 A', images: [upload.url]}), second = await createPost(users[1].id, circle.id, {content: '浏览器验收帖子 B'});
  const comment = await createPostComment(users[2].id, first.id, {content: '浏览器验收评论'});
  const featured = await managePost(users[0].id, first.id, {action: 'FEATURE', updatedAt: first.updatedAt.toISOString(), reason: '合成浏览器推荐验收'});
  await managePost(users[0].id, second.id, {action: 'PIN', updatedAt: second.updatedAt.toISOString(), reason: '合成浏览器置顶验收'});
  assert(featured.isFeatured);
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '18802'], {env, stdio: 'ignore', windowsHide: true});
  let ready = false;
  for (let i = 0; i < 150; i++) {if (app.exitCode !== null) throw Error('owned app exited'); try {if ((await fetch(base + '/api/admin/circles')).status === 401) {ready = true; break;}} catch {} await new Promise(resolve => setTimeout(resolve, 100));}
  assert(ready, 'owned server not ready'); browser = await chromium.launch();
  async function login(user) {
    const context = await browser.newContext({viewport: {width: 1280, height: 900}}), response = await context.request.post(base + '/api/auth/login', {data: {email: user.email, password}}); assert.equal(response.status(), 200);
    const {token} = await response.json(); await context.addInitScript(value => localStorage.setItem('khuiai_token', value), token);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); return {context, page, token};
  }
  const owner = await login(users[0]), author = await login(users[1]), viewer = await login(users[2]);
  const apiPostResponse = await author.context.request.post(`${base}/api/circles/${circle.id}/posts`, {headers: {Authorization: `Bearer ${author.token}`}, data: {content: 'API版本冲突与举报证据验收', images: []}}); assert.equal(apiPostResponse.status(), 201); let apiPost = (await apiPostResponse.json()).post; assert(apiPost.updatedAt);
  const editResponse = await author.context.request.patch(`${base}/api/posts/${apiPost.id}`, {headers: {Authorization: `Bearer ${author.token}`}, data: {updatedAt: apiPost.updatedAt, content: '更新后的服务器证据', images: [], characterId: null}}); assert.equal(editResponse.status(), 200); apiPost = (await editResponse.json()).post;
  const staleEdit = await author.context.request.patch(`${base}/api/posts/${apiPost.id}`, {headers: {Authorization: `Bearer ${author.token}`}, data: {updatedAt: new Date(0).toISOString(), content: '过期更新', images: []}}); assert.equal(staleEdit.status(), 409);
  const apiCommentResponse = await viewer.context.request.post(`${base}/api/posts/${apiPost.id}/comments`, {headers: {Authorization: `Bearer ${viewer.token}`}, data: {content: 'API评论版本验收'}}); assert.equal(apiCommentResponse.status(), 201); const apiComment = (await apiCommentResponse.json()).comment;
  const outsiderEdit = await owner.context.request.patch(`${base}/api/post-comments/${apiComment.id}`, {headers: {Authorization: `Bearer ${owner.token}`}, data: {updatedAt: apiComment.updatedAt, content: '未授权覆盖'}}); assert.equal(outsiderEdit.status(), 403);
  const reportResponse = await viewer.context.request.post(`${base}/api/reports`, {headers: {Authorization: `Bearer ${viewer.token}`}, data: {targetType: 'POST', targetId: apiPost.id, category: 'spam', details: '本地合成证据验收'}}); assert.equal(reportResponse.status(), 201);
  const deleteResponse = await author.context.request.delete(`${base}/api/posts/${apiPost.id}`, {headers: {Authorization: `Bearer ${author.token}`}, data: {updatedAt: apiPost.updatedAt}}); assert.equal(deleteResponse.status(), 200);
  const reportsResponse = await viewer.context.request.get(`${base}/api/reports`, {headers: {Authorization: `Bearer ${viewer.token}`}}); assert.equal(reportsResponse.status(), 200); assert((await reportsResponse.json()).some(row => row.targetId === apiPost.id && row.evidenceContent === '更新后的服务器证据'));
  checks.push('公开 API 校验作者身份和更新时间，拒绝过期/越权修改，删除后保留服务端举报证据');
  const publicFeed = await viewer.context.request.get(`${base}/api/circles/${circle.id}/posts`, {headers: {Authorization: `Bearer ${viewer.token}`}}); assert.equal(publicFeed.status(), 200);
  const listed = (await publicFeed.json()).posts; assert.equal(listed[0].id, second.id); assert(listed[1].isFeatured); checks.push('公开列表优先展示置顶帖子并返回推荐标记');
  await owner.page.goto(base + '/admin/community/posts'); await owner.page.getByRole('heading', {name: '帖子管理', exact: true}).waitFor();
  const postCard = owner.page.locator('article').filter({hasText: '浏览器验收帖子 A'}); await postCard.getByRole('button', {name: '下架', exact: true}).click();
  await owner.page.getByLabel('操作理由', {exact: true}).fill('浏览器下架验证'); await owner.page.getByRole('button', {name: '确认处置', exact: true}).click(); await owner.page.getByText('处置已记录。', {exact: true}).waitFor();
  await postCard.getByRole('img', {name: '帖子附件预览'}).waitFor(); assert.equal((await owner.context.request.get(base + upload.url, {headers: {Authorization: `Bearer ${owner.token}`}})).status(), 200); assert.equal((await fetch(base + upload.url)).status, 404);
  await owner.page.getByRole('button', {name: '恢复', exact: true}).waitFor(); checks.push('后台帖子下架成功并可恢复，操作理由保存到审计');
  checks.push('隐藏帖子附件仅可由社区管理权限预览，匿名访问被拒绝');
  await owner.page.getByRole('button', {name: '恢复', exact: true}).click(); await owner.page.getByLabel('操作理由', {exact: true}).fill('浏览器恢复验证'); await owner.page.getByRole('button', {name: '确认处置', exact: true}).click(); await owner.page.getByText('处置已记录。', {exact: true}).waitFor();
  const restored = await viewer.context.request.get(`${base}/api/circles/${circle.id}/posts`, {headers: {Authorization: `Bearer ${viewer.token}`}}); assert.equal(restored.status(), 200); assert((await restored.json()).posts.some(row => row.id === first.id)); checks.push('恢复帖子重新进入公开列表');
  await owner.page.goto(base + '/admin/community/comments'); await owner.page.getByRole('heading', {name: '评论管理', exact: true}).waitFor();
  const commentCard = owner.page.locator('article').filter({hasText: '浏览器验收评论'}); await commentCard.getByRole('button', {name: '下架', exact: true}).click(); await owner.page.getByLabel('操作理由').fill('浏览器评论下架'); await owner.page.getByRole('button', {name: '确认处置'}).click(); await owner.page.getByText('评论处置已记录。').waitFor(); await owner.page.getByRole('button', {name: '恢复', exact: true}).waitFor();
  await owner.page.getByRole('button', {name: '恢复', exact: true}).click(); await owner.page.getByLabel('操作理由').fill('浏览器评论恢复'); await owner.page.getByRole('button', {name: '确认处置'}).click(); await owner.page.getByText('评论处置已记录。').waitFor(); checks.push('后台评论下架和恢复均更新状态并记录审计');
  await owner.page.setViewportSize({width: 390, height: 844}); await owner.page.reload(); await owner.page.getByRole('heading', {name: '评论管理', exact: true}).waitFor(); assert(await owner.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await owner.page.screenshot({path: path.join(out, 'comments-mobile.png')});
  await owner.page.goto(base + '/admin/community/posts'); await owner.page.getByRole('heading', {name: '帖子管理', exact: true}).waitFor(); assert(await owner.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await owner.page.screenshot({path: path.join(out, 'posts-mobile.png')}); assert.deepEqual(errors, []); checks.push('帖子和评论后台390px无横向溢出、页面无运行错误');
  const moderationOut = path.join(out, 'full-moderation'), moderation = spawnSync(process.execPath, ['scripts/verify-m3-moderation.mjs'], {env: {...env, TEST_ISOLATED_DB: 'true', TEST_DATABASE_URL: `file:./${file}`, TEST_BASE_URL: base, TEST_EVIDENCE_DIR: moderationOut}, encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024});
  assert.equal(moderation.status, 0, moderation.stdout + moderation.stderr);
  const moderationResult = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(moderationOut, 'result.json'), 'utf8'));
  checks.push(...moderationResult.checks);
  await writeFile(path.join(out, 'result.json'), JSON.stringify({passed: true, checks, database: file, realAI: false}, null, 2));
} finally {
  if (browser) await browser.close(); if (app && app.exitCode === null) {app.kill(); await new Promise(resolve => app.once('exit', resolve));}
  await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) await rm(path.resolve('prisma', file + suffix), {force: true});
}
