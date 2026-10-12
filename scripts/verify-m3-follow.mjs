import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:18787';
assert.equal(process.env.TEST_ISOLATED_DB, 'true', '须明确指定隔离测试环境');
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), '仅运行本机隔离测试');
const out = process.env.TEST_EVIDENCE_DIR || 'artifacts/m3-follow';
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL || 'file:./m3-follow.db' } } });
const checks = [];
const check = label => { checks.push(label); console.log('PASS', label); };
const stamp = Date.now();
async function req(token, url, method = 'GET', body) {
  const response = await fetch(base + url, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: response.headers.get('content-type')?.includes('application/json') ? await response.json() : null };
}
async function signup(label) {
  const result = await req(null, '/api/auth/register', 'POST', { name: label, email: `${label}${stamp}@example.invalid`, password: 'Password123!' });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.token;
}
let browser;
try {
  await fs.mkdir(out, { recursive: true });
  const author = await signup('creator');
  const follower = await signup('follower');
  const stranger = await signup('stranger');
  const creatorUser = (await req(author, '/api/users/me')).data;
  const followerUser = (await req(follower, '/api/users/me')).data;
  assert(creatorUser?.id && followerUser?.id);
  const character = await db.character.create({ data: { name: `测试公开角色${stamp}`, personality: 'friendly', background: '', greeting: '你好', creatorId: creatorUser.id, isPublic: true, publicationRequested: true, reviewStatus: 'APPROVED' }, select: { id: true, name: true } });
  const privateCharacter = await db.character.create({ data: { name: `未审核角色${stamp}`, personality: 'hidden', background: '', creatorId: creatorUser.id, isPublic: true, publicationRequested: true, reviewStatus: 'PENDING' }, select: { id: true } });

  assert.equal((await req(null, `/api/creators/${creatorUser.username}/follow`, 'POST')).status, 401);
  assert.equal((await req(author, `/api/creators/${creatorUser.username}/follow`, 'POST')).status, 400);
  const followed = await req(follower, `/api/creators/${creatorUser.username}/follow`, 'POST');
  assert.equal(followed.status, 200); assert.equal(followed.data.following, true); assert.equal(followed.data.followerCount, 1);
  const repeated = await req(follower, `/api/creators/${creatorUser.username}/follow`, 'POST');
  assert.equal(repeated.data.changed, false); assert.equal(await db.follow.count({ where: { followingId: creatorUser.id } }), 1);
  const profile = await req(follower, `/api/creators/${creatorUser.username}`);
  assert.equal(profile.status, 200); assert.equal(profile.data.creator.isFollowing, true); assert.equal(profile.data.creator.followerCount, 1);
  const followerList = await req(null, `/api/creators/${creatorUser.username}/connections?type=followers`);
  assert.equal(followerList.status, 200); assert.equal(followerList.data.total, 1); assert.equal(followerList.data.users[0].id, followerUser.id);
  const followingList = await req(null, `/api/creators/${followerUser.username}/connections?type=following`);
  assert.equal(followingList.data.total, 1); assert.equal(followingList.data.users[0].id, creatorUser.id);
  assert.equal((await req(null, `/api/creators/${creatorUser.username}/connections?type=invalid`)).status, 400);
  check('鉴权、自关注拒绝、重复关注幂等、关注状态及粉丝/关注列表准确');

  const circle = await req(author, '/api/circles', 'POST', { name: `创作者动态测试${stamp}`, description: 'M3-04 isolated verification' });
  assert.equal(circle.status, 201);
  const circleId = circle.data.id;
  assert.equal((await req(author, `/api/circles/${circleId}/subscription`, 'PUT')).status, 200);
  const invalidCharacter = await req(author, `/api/circles/${circleId}/posts`, 'POST', { content: '未审核关联测试', characterId: privateCharacter.id });
  assert.equal(invalidCharacter.status, 400);
  const posted = await req(author, `/api/circles/${circleId}/posts`, 'POST', { content: `动态关联测试 ${stamp}`, characterId: character.id });
  assert.equal(posted.status, 201, JSON.stringify(posted.data));
  const postId = posted.data.post.id;
  const feed = await req(null, `/api/circles/${circleId}/posts`);
  assert.equal(feed.data.posts[0].character.id, character.id);
  assert.equal((await req(stranger, `/api/posts/${postId}`, 'PATCH', { content: '越权更改', images: [] })).status, 403);
  const edited = await req(author, `/api/posts/${postId}`, 'PATCH', { content: `更新关联 ${stamp}`, images: [], characterId: null });
  assert.equal(edited.status, 200); assert.equal(edited.data.post.character, null);
  assert.equal((await req(author, `/api/posts/${postId}`, 'PATCH', { content: '拒绝未审核', images: [], characterId: privateCharacter.id })).status, 400);
  await req(author, `/api/posts/${postId}`, 'PATCH', { content: `动态关联测试 ${stamp}`, images: [], characterId: character.id });
  const activity = await req(null, `/api/creators/${creatorUser.username}/activity`);
  assert.equal(activity.status, 200); assert.equal(activity.data.posts[0].character.id, character.id); assert.equal(activity.data.posts[0].id, postId);
  await db.post.update({ where: { id: postId }, data: { status: 'HIDDEN' } });
  assert.equal((await req(null, `/api/creators/${creatorUser.username}/activity`)).data.posts.length, 0);
  await db.post.update({ where: { id: postId }, data: { status: 'VISIBLE' } });
  const publicRole = await fetch(`${base}/zh/character/${character.id}`);
  assert.equal(publicRole.status, 200);
  const hiddenRole = await fetch(`${base}/zh/character/${privateCharacter.id}`);
  assert.equal(hiddenRole.status, 404);
  check('仅批准公开角色可关联；帖子可编辑取消关联；动态和公开角色页按可见状态显示');

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${base}/profile/${encodeURIComponent(creatorUser.username)}`);
  await page.evaluate(token => localStorage.setItem('khuiai_token', token), follower);
  await page.reload();
  await page.getByRole('heading', { name: '创作者动态', exact: true }).waitFor();
  await page.getByRole('button', { name: '已关注 · 取消关注' }).click();
  await page.getByRole('button', { name: '关注创作者' }).waitFor();
  assert.equal((await req(follower, `/api/creators/${creatorUser.username}`)).data.creator.followerCount, 0);
  await page.getByRole('button', { name: '关注创作者' }).click();
  await page.getByRole('button', { name: '已关注 · 取消关注' }).waitFor();
  assert.equal((await req(follower, `/api/creators/${creatorUser.username}`)).data.creator.followerCount, 1);
  await page.getByRole('link', { name: /关联角色/ }).waitFor();
  await page.getByRole('link', { name: /查看帖子/ }).waitFor();
  await page.getByRole('link', { name: /1 位粉丝/ }).waitFor();
  await page.screenshot({ path: `${out}/creator-profile-mobile.png`, fullPage: true });
  await page.goto(`${base}/profile/${encodeURIComponent(creatorUser.username)}/connections?type=followers`);
  await page.getByRole('heading', { name: '粉丝', exact: true }).waitFor();
  await page.getByRole('link', { name: new RegExp(followerUser.username) }).waitFor();
  await page.goto(`${base}/circles/${circleId}`);
  await page.getByText(`动态关联测试 ${stamp}`, { exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  check('手机宽度下创作者主页动态、双向跳转、粉丝名单和圈子锚点均可访问');
  await fs.writeFile(`${out}/result.json`, JSON.stringify({ passed: true, checks, database: process.env.TEST_DATABASE_URL || 'file:./m3-follow.db', realAI: false }, null, 2));
} finally {
  if (browser) await browser.close();
  await db.$disconnect();
}
