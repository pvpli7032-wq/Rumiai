import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:18788';
assert.equal(process.env.TEST_ISOLATED_DB, 'true', '须明确指定隔离测试环境');
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), '仅运行本机隔离测试');
const out = process.env.TEST_EVIDENCE_DIR || 'artifacts/m3-moderation';
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL || 'file:./m3-moderation.db' } } });
const checks = [];
const mark = name => { checks.push(name); console.log('PASS', name); };
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
  const adminLogin = await req(null, '/api/auth/login', 'POST', { email: 'm3-moderator@example.invalid', password: 'M3Moderator123!' });
  assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.data));
  const admin = adminLogin.data.token;
  const author = await signup('moderation_author');
  const reporter = await signup('moderation_reporter');
  const bannedUser = await signup('moderation_target');
  const authorProfile = (await req(author, '/api/users/me')).data;
  const reporterProfile = (await req(reporter, '/api/users/me')).data;
  const targetProfile = (await req(bannedUser, '/api/users/me')).data;
  const circle = await req(author, '/api/circles', 'POST', { name: `举报处置测试${stamp}`, description: 'isolated M3-05' });
  assert.equal(circle.status, 201);
  const circleId = circle.data.id;
  await req(author, `/api/circles/${circleId}/subscription`, 'PUT');
  await req(reporter, `/api/circles/${circleId}/subscription`, 'PUT');
  await req(bannedUser, `/api/circles/${circleId}/subscription`, 'PUT');
  const post = await req(author, `/api/circles/${circleId}/posts`, 'POST', { content: `需管理员隐藏的帖子 ${stamp}` });
  assert.equal(post.status, 201);
  const postId = post.data.post.id;
  const comment = await req(reporter, `/api/posts/${postId}/comments`, 'POST', { content: `需管理员隐藏的评论 ${stamp}` });
  assert.equal(comment.status, 201);
  const commentId = comment.data.comment.id;
  const postReport = await req(reporter, '/api/reports', 'POST', { targetType: 'POST', targetId: postId, category: 'spam', details: '请核查' });
  assert.equal(postReport.status, 201);
  assert.equal((await req(null, '/api/admin/moderation/reports')).status, 401);
  assert.equal((await req(reporter, '/api/admin/moderation/reports')).status, 403);
  let queue = await req(admin, '/api/admin/moderation/reports?status=OPEN');
  assert.equal(queue.status, 200); assert(queue.data.some(row => row.id === postReport.data.report.id && row.target.content.includes(String(stamp))));
  assert.equal((await req(admin, `/api/admin/moderation/reports/${postReport.data.report.id}`, 'PATCH', { action: 'REVIEWING', reason: '需要核对内容上下文' })).status, 200);
  assert((await req(admin, '/api/admin/moderation/reports?status=REVIEWING')).data.some(row => row.id === postReport.data.report.id));
  mark('社区举报队列仅审核员可读，并返回目标内容、举报理由和举报人');

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/admin/moderation`);
  await page.evaluate(token => localStorage.setItem('xingban_token', token), admin);
  await page.reload();
  await page.getByRole('heading', { name: '社区管理台' }).waitFor();
  await page.getByLabel('举报状态').selectOption('REVIEWING');
  const reportCard = page.locator('article').filter({ hasText: `需管理员隐藏的帖子 ${stamp}` });
  await reportCard.getByRole('button', { name: '隐藏内容', exact: true }).waitFor();
  await page.getByRole('heading', { name: '社区管理台' }).evaluate(element => element.scrollIntoView());
  await page.screenshot({ path: `${out}/community-moderation-mobile.png` });
  await reportCard.getByRole('button', { name: '隐藏内容', exact: true }).click();
  await page.getByLabel('举报状态').selectOption('OPEN');
  await reportCard.waitFor({ state: 'detached' });
  assert(!(await req(admin, '/api/admin/moderation/reports?status=OPEN')).data.some(row => row.id === postReport.data.report.id));
  assert(!(await req(null, `/api/circles/${circleId}/posts`)).data.posts.some(row => row.id === postId));
  const hiddenCommentReport = await req(reporter, '/api/reports', 'POST', { targetType: 'POST_COMMENT', targetId: commentId, category: 'abuse', details: '评论也需核查' });
  assert.equal(hiddenCommentReport.status, 201);
  await req(admin, `/api/admin/moderation/reports/${hiddenCommentReport.data.report.id}`, 'PATCH', { action: 'REVIEWING', reason: '需要核对评论上下文' });
  await req(admin, `/api/admin/moderation/reports/${hiddenCommentReport.data.report.id}`, 'PATCH', { action: 'HIDE', reason: '违规评论，先行隐藏' });
  assert.equal(await db.postComment.findUnique({ where: { id: commentId }, select: { status: true } }).then(row => row.status), 'HIDDEN');
  assert.deepEqual(errors, []);
  mark('手机审核台可隐藏帖子；公开动态随即不可见，评论也可独立隐藏');

  const racePost = await req(author, `/api/circles/${circleId}/posts`, 'POST', { content: `并发审核测试 ${stamp}` });
  const raceReport = await req(reporter, '/api/reports', 'POST', { targetType: 'POST', targetId: racePost.data.post.id, category: 'spam', details: '测试审核并发处理' });
  const raceResults = await Promise.all([
    req(admin, `/api/admin/moderation/reports/${raceReport.data.report.id}`, 'PATCH', { action: 'HIDE', reason: '审核员一处置' }),
    req(admin, `/api/admin/moderation/reports/${raceReport.data.report.id}`, 'PATCH', { action: 'DISMISS', reason: '审核员二处置' }),
  ]);
  assert.deepEqual(raceResults.map(result => result.status).sort(), [200, 409]);
  mark('同一举报的并发处置仅有一个审核动作成功');

  const userReport = await req(reporter, '/api/reports', 'POST', { targetType: 'USER', targetId: targetProfile.id, category: 'spam', details: '社区持续刷屏' });
  assert.equal(userReport.status, 201);
  const reportId = userReport.data.report.id;
  const ban = await req(admin, `/api/admin/moderation/reports/${reportId}`, 'PATCH', { action: 'BAN', reason: '重复发布广告，经人工核查' });
  assert.equal(ban.status, 200);
  assert.equal(await db.user.findUnique({ where: { id: targetProfile.id }, select: { communityBannedAt: true } }).then(row => Boolean(row.communityBannedAt)), true);
  assert.equal((await req(bannedUser, `/api/circles/${circleId}/posts`, 'POST', { content: 'ban bypass' })).status, 403);
  assert.equal((await req(bannedUser, `/api/posts/${postId}/comments`, 'POST', { content: 'ban bypass' })).status, 403);
  assert.equal((await req(bannedUser, `/api/creators/${authorProfile.username}/follow`, 'POST')).status, 403);
  assert.equal((await req(bannedUser, '/api/circles', 'POST', { name: 'ban bypass circle', description: 'valid synthetic request' })).status, 403);
  assert.equal((await req(null, '/api/community-appeals', 'POST', { reason: '请复核' })).status, 401);
  assert.equal((await req(author, '/api/community-appeals', 'POST', { reason: '普通账号无需申诉此限制' })).status, 409);
  mark('管理员封禁写入原因和审计；被封账号不能发帖、评论、关注或建圈，但仍能登录');

  const appeal = await req(bannedUser, '/api/community-appeals', 'POST', { reason: '这条内容不是广告，请管理员重新核查上下文。' });
  assert.equal(appeal.status, 201);
  assert.equal((await req(bannedUser, '/api/community-appeals', 'POST', { reason: '这是重复申诉请求说明文字。' })).status, 409);
  assert.equal((await req(bannedUser, '/api/community-appeals')).data[0].id, appeal.data.id);
  assert.equal((await req(null, '/api/admin/moderation/appeals')).status, 401);
  assert.equal((await req(reporter, '/api/admin/moderation/audit')).status, 403);
  const appeals = await req(admin, '/api/admin/moderation/appeals?status=OPEN');
  assert(appeals.data.some(row => row.id === appeal.data.id && row.user.username === targetProfile.username));
  const accepted = await req(admin, `/api/admin/moderation/appeals/${appeal.data.id}`, 'PATCH', { status: 'ACCEPTED', resolution: '复核后确认误判，解除社区限制。' });
  assert.equal(accepted.status, 200);
  assert.equal(await db.user.findUnique({ where: { id: targetProfile.id }, select: { communityBannedAt: true } }).then(row => row.communityBannedAt), null);
  assert.equal((await req(bannedUser, `/api/circles/${circleId}/posts`, 'POST', { content: `解封后恢复发帖 ${stamp}` })).status, 201);
  assert.equal((await req(admin, `/api/admin/moderation/appeals/${appeal.data.id}`, 'PATCH', { status: 'REJECTED', resolution: '重复处理' })).status, 409);
  const secondUserReport = await req(author, '/api/reports', 'POST', { targetType: 'USER', targetId: targetProfile.id, category: 'spam', details: '再次核查用户社区行为' });
  assert.equal(secondUserReport.status, 201);
  assert.equal((await req(admin, `/api/admin/moderation/reports/${secondUserReport.data.report.id}`, 'PATCH', { action: 'BAN', reason: '新举报复核确认' })).status, 200);
  assert.equal((await req(admin, `/api/admin/moderation/reports/${secondUserReport.data.report.id}`, 'PATCH', { action: 'UNBAN', reason: '后续复核解除限制' })).status, 200);
  assert.equal(await db.user.findUnique({ where: { id: targetProfile.id }, select: { communityBannedAt: true } }).then(row => row.communityBannedAt), null);
  const audit = await req(admin, '/api/admin/moderation/audit');
  assert.equal(audit.status, 200);
  assert(audit.data.some(row => row.action === 'BAN' && row.targetId === targetProfile.id));
  assert(audit.data.some(row => row.action === 'APPEAL_SUBMITTED' && row.targetId === targetProfile.id));
  assert(audit.data.some(row => row.action === 'APPEAL_REVIEWED_ACCEPTED' && row.targetId === appeal.data.id));
  assert(audit.data.some(row => row.action === 'UNBAN' && row.targetId === targetProfile.id));
  mark('申诉可查、重复开放申诉被阻止；审核接受后原子解封，封禁/申诉/复核均留审计');

  await page.goto(`${base}/community-appeal`);
  await page.evaluate(token => localStorage.setItem('xingban_token', token), bannedUser);
  await page.reload();
  await page.getByRole('heading', { name: '社区申诉' }).waitFor();
  await page.getByText('复核后确认误判，解除社区限制。', { exact: false }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${out}/community-appeal-mobile.png`, fullPage: true });
  mark('用户申诉页显示自己的申诉与审核结果，手机视口无横向溢出或前端异常');
  await fs.writeFile(`${out}/result.json`, JSON.stringify({ passed: true, checks, database: process.env.TEST_DATABASE_URL || 'file:./m3-moderation.db', realAI: false }, null, 2));
} finally {
  if (browser) await browser.close();
  await db.$disconnect();
}
