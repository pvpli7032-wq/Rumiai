import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir, open, rm} from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {chromium} from 'playwright';
import {createIsolatedDatabase} from './helpers/create-isolated-db.mjs';

const stamp = process.pid + '-' + Date.now();
const file = 'account-quota-' + stamp + '.db';
const port = 18841;
const base = 'http://127.0.0.1:' + port;
const out = path.resolve('artifacts/account-quota', stamp);
await mkdir(out, {recursive: true});

const env = {
  ...process.env,
  NODE_ENV: 'production',
  DATABASE_URL: 'file:./' + file,
  JWT_SECRET: randomBytes(48).toString('hex'),
  OPENAI_API_KEY: '',
  DISABLE_MOCK_AI: 'true',
  ALLOW_SIMULATED_PURCHASES: 'false',
  NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || '.next-t39',
  NEXT_PUBLIC_SITE_URL: base,
};
delete env.RUST_LOG;
delete env.ISOLATED_BUILD_DIR;
Object.assign(process.env, env);

const dbPath = path.resolve('prisma', file);
await createIsolatedDatabase(dbPath);
const {db, pragmasReady} = await import('../src/lib/db.ts');
await pragmasReady;

const QUOTA_MANAGER = ['accounts.read', 'accounts.manage', 'accounts.settings.manage'];
const SUPPORT = ['accounts.read', 'accounts.community.manage'];
const password = randomBytes(24).toString('hex');

async function makeAdmin(label, permissions) {
  const user = await db.user.create({data: {username: label + '_' + stamp, email: label + '-' + stamp + '@example.invalid', passwordHash: await bcrypt.hash(password, 8)}});
  const role = await db.adminRole.create({data: {code: 'ROLE_' + label.toUpperCase() + '_' + stamp.replace(/-/g, ''), name: label, permissions: {create: permissions.map(permission => ({permission}))}}});
  await db.adminOperator.create({data: {userId: user.id, enabled: true, version: 1}});
  await db.adminRoleAssignment.create({data: {userId: user.id, roleId: role.id}});
  return user;
}

const checks = [];
const errors = [];
let app, browser;
try {
  const target = await db.user.create({data: {username: 'quota_target_' + stamp, email: 'target-' + stamp + '@example.invalid', displayName: '额度测试用户', passwordHash: await bcrypt.hash(password, 8), coins: 777}});
  await makeAdmin('quota', QUOTA_MANAGER);
  await makeAdmin('support', SUPPORT);

  const serverLog = path.join(out, 'server.log');
  const handle = await open(serverLog, 'w');
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {env, stdio: ['ignore', handle.fd, handle.fd], windowsHide: true});
  let ready = false;
  for (let index = 0; index < 480; index += 1) {
    if (app.exitCode !== null) throw Error('server exited; see ' + serverLog);
    try {
      if ((await fetch(base + '/api/admin/session', {signal: AbortSignal.timeout(15000)})).status === 401) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, 'server did not become ready; see ' + serverLog);

  // 预热登录路由：生产构建下首次命中要现编译，冷启动可能超过浏览器默认超时。
  await fetch(base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email: 'warmup@example.invalid', password: 'x'}), signal: AbortSignal.timeout(120000)}).catch(() => {});

  browser = await chromium.launch();
  async function session(label) {
    const context = await browser.newContext({viewport: {width: 1280, height: 1000}, locale: 'zh-CN'});
    const response = await context.request.post(base + '/api/auth/login', {data: {email: label + '-' + stamp + '@example.invalid', password}, timeout: 120000});
    assert.equal(response.status(), 200, await response.text());
    await context.addInitScript(value => localStorage.setItem('xingban_token', value), (await response.json()).token);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    return page;
  }

  async function openDetail(page) {
    await page.goto(base + '/admin/accounts', {timeout: 120000});
    await page.getByRole('heading', {name: '用户管理'}).waitFor({timeout: 120000});
    await page.getByRole('button', {name: '查看用户 quota_target_' + stamp}).click();
    await page.getByRole('region', {name: '用户详情'}).waitFor();
  }

  // ---------- 有权限的管理员 ----------
  const page = await session('quota');
  await openDetail(page);

  const panel = page.getByRole('region', {name: '用户详情'});
  // 1) 两个标签
  assert.equal(await panel.getByRole('tab', {name: '基本资料'}).count(), 1);
  assert.equal(await panel.getByRole('tab', {name: '额度特例'}).count(), 1);
  checks.push('用户详情有「基本资料」与「额度特例」两个标签');

  // 2) 基本资料补了头像与昵称
  const basic = panel.getByRole('tabpanel');
  await basic.getByText('额度测试用户').first().waitFor();
  assert.equal(await basic.getByText('昵称', {exact: true}).count(), 1);
  assert.equal(await basic.getByText('登录邮箱', {exact: true}).count(), 1);
  assert.equal(await basic.getByText('777', {exact: true}).count() > 0, true, '余额要显示');
  checks.push('基本资料补了头像与昵称，余额、状态、邮箱仍在');

  // 3) 额度特例标签：只列 V3 允许的四类，默认继承公共值且显示公共值数值
  await panel.getByRole('tab', {name: '额度特例'}).click();
  const quota = panel.getByRole('tabpanel');
  await quota.getByText('每日请求上限').waitFor();
  const rows = await quota.locator('li').count();
  assert.equal(rows, 8, '只列 registry 里 userOverridable 的 8 项，不铺全部键');
  for (const label of ['每日请求上限', '每日免费回复条数', '用户收费倍率', '每日免费取消次数', '每人日发币上限', '登录每日次数', '每日发起次数', '评理奖励每日上限']) {
    await quota.getByText(label, {exact: true}).waitFor();
  }
  const inheritBadges = await quota.getByText('继承公共值', {exact: true}).count();
  assert.equal(inheritBadges, 8, '默认 8 项都是继承公共值');
  assert.equal(await quota.getByText('用户特例', {exact: true}).count(), 0);
  // 继承时给出继承来的公共值数值（默认 200 次）
  assert.equal(await quota.getByText('当前生效值：').count(), 8);
  assert.equal(await quota.getByText('200 次', {exact: true}).count() >= 1, true, '继承时必须显示继承来的公共值');
  assert.equal(await quota.getByText('公共值：200 次', {exact: true}).count(), 1);
  checks.push('额度特例只列 8 个可覆盖键，默认「继承公共值」并显示继承来的公共值数值');

  // 4) 设特例：改成 50，带到期时间
  const requestRow = quota.locator('li').filter({hasText: '每日请求上限'});
  await requestRow.getByRole('button', {name: '设特例'}).click();
  await requestRow.getByLabel('每日请求上限特例值').fill('50');
  const expiry = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const pad = value => String(value).padStart(2, '0');
  await requestRow.getByLabel('每日请求上限特例到期时间').fill(`${expiry.getFullYear()}-${pad(expiry.getMonth() + 1)}-${pad(expiry.getDate())}T${pad(expiry.getHours())}:${pad(expiry.getMinutes())}`);
  await requestRow.getByRole('button', {name: '保存特例'}).click();
  await quota.getByRole('status').filter({hasText: '已保存「每日请求上限」的用户特例。'}).waitFor();
  const savedRow = quota.locator('li').filter({hasText: '每日请求上限'});
  await savedRow.getByText('用户特例', {exact: true}).waitFor();
  assert.equal(await savedRow.getByText('50 次', {exact: true}).count() > 0, true);
  await savedRow.getByText(/到期时间：/).waitFor();
  assert.equal(await quota.getByText('继承公共值', {exact: true}).count(), 7);
  const stored = await db.userSettingOverride.findUnique({where: {userId_key: {userId: target.id, key: 'billing.hardDailyMessages'}}});
  assert(stored && stored.expiresAt, '特例应带到期时间入库');
  checks.push('能设特例：当前值变 50 次、来源变「用户特例」、显示到期时间');

  // 5) 清除特例：立刻回落公共值，不整页重载
  await savedRow.getByRole('button', {name: '清除特例'}).click();
  await quota.getByRole('status').filter({hasText: '已清除「每日请求上限」的用户特例，回到公共值。'}).waitFor();
  const clearedRow = quota.locator('li').filter({hasText: '每日请求上限'});
  await clearedRow.getByText('继承公共值', {exact: true}).waitFor();
  await clearedRow.getByText('公共值：200 次', {exact: true}).waitFor();
  assert.equal(await quota.getByText('用户特例', {exact: true}).count(), 0);
  assert.equal(await db.userSettingOverride.count({where: {userId: target.id}}), 0, '清除后库里不应残留');
  // 仍在同一个标签上（没有整页重载）
  assert.equal(await quota.getByText('每日请求上限', {exact: true}).count(), 1);
  checks.push('清除特例后立刻回落公共值 200 次，且停留在该标签（无整页重载）');

  await page.screenshot({path: path.join(out, 'quota-tab-1280.png'), fullPage: true});

  // ---------- 无 accounts.settings.manage 的客服 ----------
  const supportPage = await session('support');
  await openDetail(supportPage);
  const supportPanel = supportPage.getByRole('region', {name: '用户详情'});
  await supportPanel.getByRole('tab', {name: '额度特例'}).click();
  const supportQuota = supportPanel.getByRole('tabpanel');
  await supportQuota.getByText('没有用户额度设置权限').waitFor();
  await supportQuota.getByText(/accounts\.settings\.manage/).waitFor();
  assert.equal(await supportQuota.getByRole('button', {name: '设特例'}).count(), 0, '无权限不应出现设特例按钮');
  assert.equal(await supportQuota.locator('li').count(), 0, '无权限不渲染特例列表');
  await supportPage.screenshot({path: path.join(out, 'quota-tab-denied.png'), fullPage: true});
  checks.push('没有 accounts.settings.manage 时该标签只读隐藏，给中文说明且没有编辑入口');

  // ---------- 360px 无横向溢出 ----------
  await page.setViewportSize({width: 360, height: 900});
  await page.goto(base + '/admin/accounts');
  await page.getByRole('button', {name: '查看用户 quota_target_' + stamp}).click();
  await page.getByRole('region', {name: '用户详情'}).getByRole('tab', {name: '额度特例'}).click();
  await page.getByText('每日请求上限').first().waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '360px 不应整页横向溢出');
  await page.screenshot({path: path.join(out, 'quota-tab-360.png'), fullPage: true});
  checks.push('360px 下额度特例标签无整页横向溢出');

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
