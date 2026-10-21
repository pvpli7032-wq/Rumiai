import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir, open, rm} from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {chromium} from 'playwright';
import {createIsolatedDatabase} from './helpers/create-isolated-db.mjs';

const stamp = process.pid + '-' + Date.now();
const file = 'admin-pins-' + stamp + '.db';
const port = 18831;
const base = 'http://127.0.0.1:' + port;
const out = path.resolve('artifacts/admin-pins', stamp);
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
delete env.ISOLATED_BUILD_DIR;
Object.assign(process.env, env);

const dbPath = path.resolve('prisma', file);
await createIsolatedDatabase(dbPath);
const {db, pragmasReady} = await import('../src/lib/db.ts');
await pragmasReady;

const ALL = ['accounts.read','characters.read','moderation.read','community.read','site.content.read','disputes.read','mirror.read','growth.read','analytics.read','ai.models.read','ai.providers.read','ai.costs.read','finance.read','payments.merchants.read','settings.read','tasks.read','operations.read','admin.staff.read','admin.audit.read','compliance.read'];
const FEW = ['accounts.read'];
const password = randomBytes(24).toString('hex');

async function makeAdmin(label, permissions) {
  const user = await db.user.create({data: {username: label + '_' + stamp, email: label + '-' + stamp + '@example.invalid', passwordHash: await bcrypt.hash(password, 8)}});
  const role = await db.adminRole.create({data: {code: 'ROLE_' + label.toUpperCase() + '_' + stamp.replace('-', ''), name: label, permissions: {create: permissions.map(permission => ({permission}))}}});
  await db.adminOperator.create({data: {userId: user.id, enabled: true, version: 1}});
  await db.adminRoleAssignment.create({data: {userId: user.id, roleId: role.id}});
  return user;
}

const checks = [];
const errors = [];
let app, browser;
try {
  const owner = await makeAdmin('full', ALL);
  const limited = await makeAdmin('few', FEW);

  const serverLog = path.join(out, 'server.log');
  const handle = await open(serverLog, 'w');
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {env, stdio: ['ignore', handle.fd, handle.fd], windowsHide: true});
  let ready = false;
  for (let index = 0; index < 480; index += 1) {
    if (app.exitCode !== null) throw Error('production server exited; see ' + serverLog);
    try {
      if ((await fetch(base + '/api/admin/session', {signal: AbortSignal.timeout(15000)})).status === 401) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, 'dev server did not become ready; see ' + serverLog);

  browser = await chromium.launch();
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, locale: 'zh-CN'});
  async function login(user) {
    const response = await context.request.post(base + '/api/auth/login', {data: {email: user.email, password}});
    assert.equal(response.status(), 200, await response.text());
    return (await response.json()).token;
  }

  const fullToken = await login(owner);
  await context.addInitScript(value => localStorage.setItem('xingban_token', value), fullToken);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/admin');
  await page.getByRole('heading', {name: '管理中心'}).waitFor();

  // 1) 没有置顶时不渲染常用区
  assert.equal(await page.getByRole('region', {name: '常用入口'}).count(), 0, '未置顶时不应出现常用区');
  assert.equal(await page.getByText('常用', {exact: true}).count(), 0, '未置顶时不应出现「常用」标题');
  checks.push('未置顶时侧栏没有「常用」区，也不留空标题');

  // 2) 置顶四项（先展开对应分组：默认只展开当前页面所在分组）
  const pinTargets = ['用户管理', '角色管理', '设置中心', '财务支付'];
  const groupsOf = {'用户管理': '用户', '角色管理': '内容与社区', '设置中心': '系统设置', '财务支付': 'AI 与商业'};
  const nav = page.getByRole('navigation', {name: '后台导航'}).first();
  for (const label of pinTargets) {
    const groupButton = nav.getByRole('button', {name: groupsOf[label]});
    if ((await groupButton.getAttribute('aria-expanded')) === 'false') await groupButton.click();
    await nav.getByRole('button', {name: `置顶「${label}」`}).click();
  }
  const pinRegion = page.getByRole('region', {name: '常用入口'});
  await pinRegion.waitFor();
  assert.equal(await pinRegion.getByRole('link').count(), 4);
  for (const label of pinTargets) await pinRegion.getByRole('link', {name: label}).waitFor();
  checks.push('置顶 4 项后常用区显示 4 个入口，顺序与置顶顺序一致');

  // 3) 第 5 项被拒绝，且不顶掉最早的那个
  const analyticsGroup = nav.getByRole('button', {name: '增长与玩法'});
  if ((await analyticsGroup.getAttribute('aria-expanded')) === 'false') await analyticsGroup.click();
  await nav.getByRole('button', {name: '置顶「运营分析」'}).click();
  await page.getByRole('status').filter({hasText: '常用最多 4 项，请先取消一个再置顶。'}).waitFor();
  assert.equal(await pinRegion.getByRole('link').count(), 4);
  await pinRegion.getByRole('link', {name: '用户管理'}).waitFor();
  assert.equal(await nav.getByRole('button', {name: '置顶「运营分析」'}).count(), 1, '被拒绝的项不应变成已置顶');
  checks.push('已有 4 项时第 5 项给出中文提示并拒绝，不静默丢弃也不顶掉最早项');

  // 4) 刷新后仍是这 4 项（按管理员 id 存）
  await page.reload();
  await page.getByRole('region', {name: '常用入口'}).getByRole('link', {name: '用户管理'}).waitFor();
  assert.equal(await page.getByRole('region', {name: '常用入口'}).getByRole('link').count(), 4);
  const storedKey = 'admin.nav.pins.' + owner.id;
  const stored = await page.evaluate(key => localStorage.getItem(key), storedKey);
  assert(stored, '置顶应写在本人 id 的键上');
  assert.equal(JSON.parse(stored).length, 4);
  checks.push('置顶写在 admin.nav.pins.<userId> 上，刷新后保持');

  // 5) 取消置顶
  await nav.getByRole('button', {name: '取消置顶「角色管理」'}).first().click();
  await page.getByRole('status').filter({hasText: '已取消置顶「角色管理」。'}).waitFor();
  assert.equal(await page.getByRole('region', {name: '常用入口'}).getByRole('link').count(), 3);
  checks.push('取消置顶后常用区减少一项');

  // 6) 换人登录不串：另一个管理员看不到这 4 项
  const fewToken = await login(limited);
  const second = await browser.newContext({viewport: {width: 1280, height: 900}, locale: 'zh-CN'});
  await second.addInitScript(value => localStorage.setItem('xingban_token', value), fewToken);
  const page2 = await second.newPage();
  page2.on('pageerror', error => errors.push(error.message));
  await page2.goto(base + '/admin');
  await page2.getByRole('heading', {name: '管理中心'}).waitFor();
  assert.equal(await page2.getByRole('region', {name: '常用入口'}).count(), 0, '另一个管理员不应看到别人的置顶');
  // 他自己置顶一项，键不同
  const nav2 = page2.getByRole('navigation', {name: '后台导航'}).first();
  const usersGroup2 = nav2.getByRole('button', {name: '用户'});
  if ((await usersGroup2.getAttribute('aria-expanded')) === 'false') await usersGroup2.click();
  await nav2.getByRole('button', {name: '置顶「用户管理」'}).click();
  await page2.getByRole('region', {name: '常用入口'}).getByRole('link', {name: '用户管理'}).waitFor();
  const fewKey = 'admin.nav.pins.' + limited.id;
  assert.notEqual(fewKey, storedKey);
  assert.equal(JSON.parse(await page2.evaluate(key => localStorage.getItem(key), fewKey)).length, 1);
  checks.push('置顶按管理员 id 隔离：换人登录看不到别人的置顶，各自写各自的键');

  // 7) 权限过滤：把自己的键写成无权限的入口，常用区不应显示
  await page2.evaluate(key => localStorage.setItem(key, JSON.stringify(['/admin/finance', '/admin/accounts'])), fewKey);
  await page2.reload();
  await page2.getByRole('region', {name: '常用入口'}).getByRole('link', {name: '用户管理'}).waitFor();
  assert.equal(await page2.getByRole('region', {name: '常用入口'}).getByRole('link').count(), 1, '无权限的置顶项必须被过滤');
  assert.equal(await page2.getByRole('link', {name: '财务支付'}).count(), 0);
  checks.push('置顶项按权限过滤：无权限的置顶不显示，也不能借置顶越权');

  // 8) 收起成图标栏：置顶项排在最前，且不重复
  await page.setViewportSize({width: 1280, height: 900});
  await page.getByRole('button', {name: '收起侧栏'}).click();
  const rail = page.getByRole('navigation', {name: '后台导航'}).first();
  await rail.waitFor();
  const railLabels = await rail.getByRole('link').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
  assert.equal(new Set(railLabels).size, railLabels.length, '图标栏不应出现重复入口');
  assert.equal(railLabels[0], '用户管理');
  checks.push('收起成图标栏时置顶项排在最前且不重复');

  // 9) 移动端抽屉里也有常用区（同一浏览器的置顶，换成手机宽度）
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(base + '/admin');
  await page.getByRole('button', {name: '打开后台菜单'}).click();
  const dialog = page.getByRole('dialog', {name: '后台菜单'});
  await dialog.getByRole('region', {name: '常用入口'}).waitFor();
  assert.equal(await dialog.getByRole('region', {name: '常用入口'}).getByRole('link').count(), 3);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({path: path.join(out, 'admin-drawer-390.png'), fullPage: true});
  checks.push('移动端抽屉同样有常用区，390px 无整页横向溢出');

  assert.deepEqual(errors, []);
  console.log('PASS');
  for (const check of checks) console.log(' - ' + check);
  console.log('artifacts: ' + out);
} finally {
  await browser?.close();
  if (app && app.exitCode === null) { app.kill(); await new Promise(resolve => app.once('exit', resolve)); }
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) await rm(path.resolve('prisma', file + suffix), {force: true});
}
