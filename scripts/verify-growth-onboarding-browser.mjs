import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {chromium} from 'playwright';
import {createIsolatedDatabase} from './helpers/create-isolated-db.mjs';

/**
 * 新手引导与邀请前端的隔离浏览器验收（V3 表 9 增长、表 22）。
 *
 * 覆盖：三步引导（选兴趣 → 推荐角色 → 开始第一次互动）、整页跳过、完成后不再拦人、
 * 推荐为空时给出口、接口失败时的错误态与重试、邀请码与分享链接复制、开关关闭不展示入口，
 * 以及 375px 下无整页横向溢出。引导开关通过设置接口改，走的是线上同一条写入链路。
 */
const stamp = process.pid + '-' + Date.now();
const file = 'growth-onboarding-' + stamp + '.db';
const port = 18817;
const base = 'http://127.0.0.1:' + port;
const out = path.resolve('artifacts/growth-onboarding-browser', stamp);
await mkdir(out, {recursive: true});

const env = {
  ...process.env,
  NODE_ENV: 'production',
  DATABASE_URL: 'file:./' + file,
  JWT_SECRET: randomBytes(48).toString('hex'),
  OPENAI_API_KEY: '',
  DISABLE_MOCK_AI: 'true',
  ALLOW_SIMULATED_PURCHASES: 'false',
  NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || '.next-build',
  NEXT_PUBLIC_SITE_URL: base,
};
delete env.RUST_LOG;
Object.assign(process.env, env);

const dbPath = path.resolve('prisma', file);
await createIsolatedDatabase(dbPath);
const {db, pragmasReady} = await import('../src/lib/db.ts');
await pragmasReady;
const {bootstrapOwner} = await import('../src/lib/admin/management-service.ts');

const password = randomBytes(24).toString('hex');
const checks = [];
const errors = [];
let app, browser;

async function makeUser(label) {
  return db.user.create({
    data: {username: label + '_' + stamp, email: label + '-' + stamp + '@example.invalid', passwordHash: await bcrypt.hash(password, 8)},
  });
}

try {
  const owner = await makeUser('owner');
  const guided = await makeUser('guided');
  const skipper = await makeUser('skipper');
  await bootstrapOwner(owner.email);

  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {env, stdio: 'ignore', windowsHide: true});
  let ready = false;
  for (let index = 0; index < 240; index += 1) {
    if (app.exitCode !== null) throw Error('isolated production server exited');
    try {
      if ((await fetch(base + '/api/growth/onboarding', {signal: AbortSignal.timeout(8000)})).status === 401) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, 'isolated production server did not become ready');

  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: {width: 390, height: 844},
    locale: 'zh-CN',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  async function login(user) {
    const response = await context.request.post(base + '/api/auth/login', {data: {email: user.email, password}});
    assert.equal(response.status(), 200);
    return (await response.json()).token;
  }
  async function setGrowthSettings(token, changes) {
    const response = await context.request.patch(base + '/api/admin/settings', {
      headers: {Authorization: 'Bearer ' + token},
      data: {group: 'growth', changes, expectedVersions: {}},
    });
    assert.equal(response.status(), 200, await response.text());
  }

  const ownerToken = await login(owner);
  await setGrowthSettings(ownerToken, [
    {key: 'growth.onboardingEnabled', value: true},
    {key: 'growth.interestTags', value: ['治愈', '冒险', '日常']},
    {key: 'growth.inviteEnabled', value: true},
    {key: 'growth.inviteRewardCoins', value: 20},
  ]);

  const guidedToken = await login(guided);
  await context.addInitScript(value => localStorage.setItem('xingban_token', value), guidedToken);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));

  // ---- 推荐为空：给「去看全部角色」出口 ----
  await page.goto(base + '/onboarding');
  await page.getByRole('heading', {name: '欢迎来到星伴'}).waitFor();
  await page.getByRole('button', {name: '下一步'}).click();
  await page.getByText('暂时没有推荐角色').waitFor();
  assert.equal(await page.getByRole('link', {name: '去看全部角色 →'}).getAttribute('href'), '/discover');
  checks.push('推荐为空时显示空态与「去看全部角色」出口');
  await page.getByRole('button', {name: '上一步'}).click();

  // 建好推荐角色后重新进入引导页：推荐列表是进入时读的，不能拿旧响应继续断言。
  const characters = [];
  for (const [index, spec] of [['治愈', '温柔陪伴'], ['冒险', '远征向导'], ['日常', '街角咖啡']].entries()) {
    characters.push(await db.character.create({
      data: {name: '引导角色' + (index + 1), personality: '验收', tagline: spec[1], background: '隔离验收', creatorId: owner.id, tags: spec[0], isPublic: true, reviewStatus: 'APPROVED', chatCount: 100 - index},
    }));
  }
  const recommendedProbe = await context.request.get(base + '/api/growth/onboarding', {headers: {Authorization: 'Bearer ' + guidedToken}});
  assert.equal(recommendedProbe.status(), 200, await recommendedProbe.text());
  assert.equal((await recommendedProbe.json()).recommended.length, 3);
  await page.reload();
  await page.getByRole('heading', {name: '欢迎来到星伴'}).waitFor();

  // ---- 三步流程 ----
  assert.equal(await page.getByRole('button', {name: '治愈'}).getAttribute('aria-pressed'), 'false');
  await page.getByRole('button', {name: '治愈'}).click();
  await page.getByRole('button', {name: '冒险'}).click();
  assert.equal(await page.getByRole('button', {name: '治愈'}).getAttribute('aria-pressed'), 'true');
  checks.push('第一步：兴趣标签可多选，按下状态正确');

  await page.getByRole('button', {name: '下一步'}).click();
  await page.getByRole('button', {name: /引导角色1/}).waitFor();
  assert.equal(await page.getByRole('button', {name: /引导角色/}).count(), 3);
  await page.getByRole('button', {name: /引导角色2/}).click();
  assert.equal(await page.getByRole('button', {name: /引导角色2/}).getAttribute('aria-pressed'), 'true');
  checks.push('第二步：推荐角色卡片可单选');

  await page.getByRole('button', {name: '下一步'}).click();
  await page.getByText('已选兴趣').waitFor();
  await page.getByText('治愈', {exact: true}).last().waitFor();
  await page.getByRole('button', {name: /和引导角色2开始聊天/}).click();
  await page.waitForURL('**/chat?character=' + characters[1].id);
  checks.push('第三步：点「和某某开始聊天」进入与该角色的聊天');

  const afterGuided = await context.request.get(base + '/api/growth/onboarding', {headers: {Authorization: 'Bearer ' + guidedToken}});
  const guidedBody = await afterGuided.json();
  assert.equal(guidedBody.completed, true);
  assert.deepEqual([...guidedBody.interests].sort(), ['冒险', '治愈'].sort());
  checks.push('引导结果写入后端：completed 为真、兴趣标签按所选保存');

  await page.goto(base + '/onboarding');
  await page.waitForURL('**/discover');
  checks.push('已完成引导后再访问引导页直接放行到发现页');

  // ---- 整页跳过 ----
  const skipperToken = await login(skipper);
  await context.addInitScript(value => localStorage.setItem('xingban_token', value), skipperToken);
  const skipPage = await context.newPage();
  skipPage.on('pageerror', error => errors.push(error.message));
  await skipPage.goto(base + '/onboarding');
  await skipPage.getByRole('heading', {name: '欢迎来到星伴'}).waitFor();
  await skipPage.getByRole('button', {name: '跳过引导'}).click();
  await skipPage.waitForURL('**/discover');
  const skipped = await (await context.request.get(base + '/api/growth/onboarding', {headers: {Authorization: 'Bearer ' + skipperToken}})).json();
  assert.equal(skipped.completed, true);
  await skipPage.goto(base + '/onboarding');
  await skipPage.waitForURL('**/discover');
  checks.push('整页跳过写入 completed，之后不再被拦回引导页');

  // ---- 接口失败：错误态与重试 ----
  await context.addInitScript(() => {});
  const brokenPage = await context.newPage();
  await brokenPage.route('**/api/growth/onboarding', route => route.fulfill({status: 500, json: {error: '引导服务暂不可用。'}}));
  await brokenPage.goto(base + '/onboarding');
  await brokenPage.getByText('引导加载失败').waitFor();
  await brokenPage.getByText('引导服务暂不可用。').waitFor();
  await brokenPage.unroute('**/api/growth/onboarding');
  await brokenPage.getByRole('button', {name: '重试'}).click();
  await brokenPage.waitForURL('**/discover');
  checks.push('接口失败显示错误态，重试后恢复');
  await brokenPage.close();

  // ---- 邀请卡片 ----
  await page.goto(base + '/profile');
  await page.getByRole('heading', {name: '邀请好友'}).waitFor();
  const codeText = (await page.locator('span.font-mono').first().innerText()).trim();
  assert.match(codeText, /^[0-9A-Z]{8}$/);
  await page.getByText('好友通过你的邀请注册并完成首次聊天后，你获得 20 金币。').waitFor();
  await page.getByRole('button', {name: '复制邀请码'}).click();
  await page.getByRole('status').filter({hasText: '邀请码已复制。'}).waitFor();
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).trim(), codeText);
  await page.getByRole('button', {name: '复制链接'}).click();
  await page.getByRole('status').filter({hasText: '分享链接已复制。'}).waitFor();
  const link = (await page.evaluate(() => navigator.clipboard.readText())).trim();
  assert.match(link, new RegExp('/register\\?invite=' + codeText + '$'));
  checks.push('邀请卡片展示邀请码与分享链接，复制成功并写入剪贴板，奖励文案按「发给邀请人」口径');

  // ---- 开关关闭：不展示入口 ----
  await setGrowthSettings(ownerToken, [{key: 'growth.inviteEnabled', value: false}]);
  await page.goto(base + '/profile');
  await page.getByText('我的数据').waitFor();
  assert.equal(await page.getByRole('heading', {name: '邀请好友'}).count(), 0);
  checks.push('邀请开关关闭时「我的」页不展示邀请入口');

  await setGrowthSettings(ownerToken, [{key: 'growth.onboardingEnabled', value: false}]);
  const third = await makeUser('third');
  const thirdToken = await login(third);
  await context.addInitScript(value => localStorage.setItem('xingban_token', value), thirdToken);
  const thirdPage = await context.newPage();
  await thirdPage.goto(base + '/onboarding');
  await thirdPage.waitForURL('**/discover');
  checks.push('引导开关关闭时直接放行，不拦人');

  // ---- 移动端无横向溢出 ----
  await page.setViewportSize({width: 375, height: 812});
  for (const route of ['/profile', '/discover']) {
    await page.goto(base + route);
    await page.waitForLoadState('networkidle');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), route + ' 在 375px 出现整页横向溢出');
  }
  await page.screenshot({path: path.join(out, 'profile-375.png'), fullPage: true});
  checks.push('375px 下「我的」页无整页横向溢出');

  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'result.json'), JSON.stringify({passed: true, checks, database: file, providerCalled: false}, null, 2));
  console.log('PASS');
  for (const check of checks) console.log(' - ' + check);
  console.log('artifacts: ' + out);
} finally {
  await browser?.close();
  if (app && app.exitCode === null) {
    app.kill();
    await new Promise(resolve => app.once('exit', resolve));
  }
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) await rm(path.resolve('prisma', file + suffix), {force: true});
}
