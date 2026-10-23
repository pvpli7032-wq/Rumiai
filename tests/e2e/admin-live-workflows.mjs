import {strict as assert} from 'node:assert';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
if (process.env.DATABASE_URL) throw Error('E2E refuses an external DATABASE_URL; it owns its isolated fixture.');
const root = fileURLToPath(new URL('../..', import.meta.url));
const children = [];
let fixture;
let browser;

function start(app, port, env) {
  const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)], {
    cwd: path.join(root, 'apps', app), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const record = {child, output: '', closed: null};
  record.closed = new Promise(resolve => child.once('close', resolve));
  child.on('error', error => { record.output += error.message; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { record.output += data.toString(); });
  children.push(record);
}

async function stopChildren() {
  await Promise.all(children.map(async ({child, closed}) => {
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore', windowsHide: true}); }
        catch { if (child.exitCode === null) child.kill(); }
      } else child.kill('SIGTERM');
    }
    let timer;
    try {
      await Promise.race([closed, new Promise((_, reject) => {
        timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error(`Test process ${child.pid} failed to close`)); }, 8000);
      })]);
    } finally { clearTimeout(timer); }
  }));
}

async function waitForService(url) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const failed = children.find(({child}) => child.exitCode !== null || child.signalCode !== null);
    if (failed) throw Error(`Test service exited: ${failed.output}`);
    try { if ((await fetch(url, {signal: AbortSignal.timeout(2000)})).status < 500) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error(`Service not ready: ${url}\n${children.map(child => child.output).join('\n')}`);
}

try {
  fixture = await createFixture();
  // Domain-only fixture: this creates confirmed local records, not a merchant payment.
  const financeNow = new Date();
  const financePlan = await fixture.db.membershipPlan.upsert({
    where: {code: 'MONTHLY'},
    update: {name: 'E2E 财务会员', durationDays: 30, priceCents: 3000, benefitsJson: JSON.stringify([{key: 'CHAT_PRICE_MULTIPLIER', label: '聊天折扣', value: 0.8}]), isActive: true, sortOrder: 0, version: 1},
    create: {code: 'MONTHLY', name: 'E2E 财务会员', durationDays: 30, priceCents: 3000, benefitsJson: JSON.stringify([{key: 'CHAT_PRICE_MULTIPLIER', label: '聊天折扣', value: 0.8}]), isActive: true, sortOrder: 0, version: 1},
  });
  await fixture.db.membershipPolicy.upsert({where: {id: 'primary'}, update: {refundWindowHours: 24, usageChargePeriodHours: 24}, create: {id: 'primary', refundWindowHours: 24, usageChargePeriodHours: 24, version: 1}});
  const membershipService = await import('@rumiai/backend/modules/memberships/service');
  async function prepareMembershipRefund(suffix, used) {
    const payment = await fixture.db.paymentOrder.create({data: {orderNo: `MEM-FIN-PAY-${suffix}`, idempotencyKey: `mem-fin-pay-${suffix}`, userId: fixture.user.id, packageCoins: 0, packageBonus: 0, coinAmount: 0, amountCnyCents: 3000, currency: 'CNY', provider: 'EZFP', providerTradeNo: `mem-fin-trade-${suffix}`, status: 'PENDING', createdAt: financeNow}});
    const order = await membershipService.createMembershipOrder({userId: fixture.user.id, planCode: financePlan.code, idempotencyKey: `mem-fin-${suffix}`, orderNo: `MEM-FIN-${suffix}`, paymentOrderId: payment.id});
    await membershipService.markMembershipPaid(order.orderNo, financeNow);
    await fixture.db.paymentOrder.update({where: {id: payment.id}, data: {status: 'PAID', paidAt: financeNow}});
    if (used) await membershipService.recordMembershipUsage({orderNo: order.orderNo, userId: fixture.user.id, benefitCode: 'CHAT_PRICE_MULTIPLIER', idempotencyKey: `mem-fin-usage-${suffix}`});
    const refund = await membershipService.requestMembershipRefund(order.orderNo, '后台财务抽屉验收', financeNow);
    await membershipService.completeMembershipRefund(order.orderNo, `mem-fin-refund-${suffix}`, financeNow);
    return {orderNo: order.orderNo, paymentOrderNo: payment.orderNo, refundId: refund.id, amountCents: refund.amountCents};
  }
  const membershipFinance = {
    used: await prepareMembershipRefund('USED-20261023', true),
    unused: await prepareMembershipRefund('UNUSED-20261023', false),
  };
  await fixture.disconnect();
  const env = {...process.env,
    DATABASE_URL: `file:${fixture.dbPath.replaceAll('\\', '/')}`,
    BACKUPS_DIRECTORY: path.join(fixture.dir, 'backups'), UPLOADS_DIRECTORY: path.join(fixture.dir, 'uploads'),
    INTERNAL_API_ORIGIN: 'http://127.0.0.1:3012', ADMIN_API_INTERNAL_URL: 'http://127.0.0.1:3012',
    INTERNAL_ADMIN_ORIGIN: 'http://127.0.0.1:3011', ADMIN_PUBLIC_ORIGIN: 'http://127.0.0.1:3011',
    NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'production',
    JWT_SECRET: 'e2e-only-jwt-secret-012345678901234567890123', NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3010',
    EZFP_ENABLED: 'false', EZFP_REFUNDS_ENABLED: 'false', EZFP_PID: '',
    EZFP_MERCHANT_PRIVATE_KEY: '', EZFP_PLATFORM_PUBLIC_KEY: '', AI_API_KEY: '', OPENAI_API_KEY: '',
  };
  for (const [app, port] of [['api', 3012], ['admin', 3011], ['web', 3010]]) start(app, port, env);
  await waitForService('http://127.0.0.1:3011/admin/login');
  await waitForService('http://127.0.0.1:3010/login');
  browser = await chromium.launch({headless: true});
  const admin = await browser.newPage();
  const front = await browser.newPage();
  for (const url of ['/api/home', '/api/explore', '/th', '/th/explore']) {
    const response = await front.request.get(`http://127.0.0.1:3010${url}`);
    assert.equal(response.status(), 200, `extracted web/API projection must work: ${url}`);
  }
  await admin.goto('http://127.0.0.1:3011/admin/login');
  await admin.getByLabel('登录邮箱').fill(fixture.admin.email);
  await admin.getByLabel('密码').fill(fixture.password);
  const loginResponse = admin.waitForResponse(r => r.url().includes('/api/admin/auth/login'));
  await admin.getByRole('button', {name: '登录管理中心'}).click();
  assert.equal((await loginResponse).status(), 200);
  await admin.waitForURL('**/admin');
  assert.match(await admin.locator('h1').innerText(), /管理中心|工作台|概览/);
  await admin.goto('http://127.0.0.1:3011/admin/accounts');
  await admin.getByTitle('收起侧栏').click();
  assert.equal(await admin.evaluate(() => localStorage.getItem('admin.sidebar.collapsed')), '1');
  await admin.reload();
  assert.equal(await admin.evaluate(() => localStorage.getItem('admin.sidebar.collapsed')), '1');

  const operations = await admin.request.get('http://127.0.0.1:3011/api/admin/operations');
  assert.equal(operations.status(), 200);
  assert.equal((await operations.json()).database.migrations.pendingCount, 0);
  const accounts = await admin.request.get('http://127.0.0.1:3011/api/admin/accounts');
  assert.equal(accounts.status(), 200);
  const target = (await accounts.json()).items.find(user => user.email === fixture.user.email);
  assert.ok(target, 'the intended fixture user must appear; do not silently update a different user');
  await admin.getByLabel('搜索用户').fill(fixture.user.email);
  await admin.getByRole('button', {name: '搜索用户'}).click();
  await admin.getByRole('button', {name: `查看用户 ${fixture.user.username}`}).click();
  const accountDialog = admin.getByRole('dialog', {name: /用户详情/});
  await accountDialog.waitFor({state: 'visible'});
  await admin.getByText('正在读取用户详情…').waitFor({state: 'hidden'});
  await admin.getByRole('tab', {name: '会员与资产'}).click();
  await accountDialog.getByText('MEM-FIN-USED-20261023', {exact: false}).waitFor();
  await accountDialog.getByText('MEM-FIN-UNUSED-20261023', {exact: false}).waitFor();
  await accountDialog.getByText('退款：COMPLETED · ¥29.00 · 扣费 ¥1.00', {exact: true}).waitFor();
  await accountDialog.getByText('退款：COMPLETED · ¥30.00 · 扣费 ¥0.00', {exact: true}).waitFor();
  await admin.getByRole('tab', {name: '基本资料'}).click();
  await admin.getByLabel('昵称').fill('E2E 表单资料');
  await admin.getByPlaceholder('说明为什么需要修改资料').fill('隔离浏览器表单验收');
  await admin.getByRole('button', {name: '保存公开资料'}).click();
  await admin.waitForTimeout(1000);
  await admin.getByRole('tab', {name: '记录与关联'}).click();
  await admin.getByText('隔离浏览器表单验收', {exact: true}).waitFor();
  const adminCookieOnlyMe = await admin.request.get('http://127.0.0.1:3010/api/users/me');
  assert.equal(adminCookieOnlyMe.status(), 401, 'admin session cookie must not authenticate the storefront');
  const ordinaryAdminLogin = await front.request.post('http://127.0.0.1:3012/api/admin/auth/login', {
    headers: {Origin: 'http://127.0.0.1:3011'}, data: {email: fixture.user.email, password: fixture.password},
  });
  assert.equal(ordinaryAdminLogin.status(), 403, 'a valid ordinary-user password must not grant admin login');
  const frontLogin = await front.request.post('http://127.0.0.1:3010/api/auth/login', {data: {email: fixture.user.email, password: fixture.password}});
  assert.equal(frontLogin.status(), 200);
  const {token} = await frontLogin.json();
  assert.ok(token);
  const me = await front.request.get('http://127.0.0.1:3010/api/users/me', {headers: {Authorization: `Bearer ${token}`}});
  assert.equal(me.status(), 200);
  assert.equal((await me.json()).displayName, 'E2E 表单资料');

  const existing = await admin.request.get('http://127.0.0.1:3011/api/admin/memberships');
  assert.equal(existing.status(), 200);
  const plan = (await existing.json()).plans.find(item => item.code === 'MONTHLY');
  assert.ok(plan);
  const configured = await admin.request.patch('http://127.0.0.1:3011/api/admin/memberships', {data: {
    ...plan, name: 'E2E 月会员', priceCents: 100, isActive: true,
    benefits: [{key: 'DAILY_FREE_REPLIES', label: '每日免费回复', value: 5}], reason: '隔离会员配置验收',
  }});
  assert.equal(configured.status(), 200);
  await admin.goto('http://127.0.0.1:3011/admin/memberships');
  await admin.getByRole('tab', {name: 'E2E 月会员', exact: true}).click();
  await admin.getByLabel('方案价格（分）').fill('123');
  await admin.getByRole('button', {name: '保存配置'}).click();
  await admin.getByText('已保存，前台将读取最新方案。', {exact: true}).waitFor();
  const publicCatalog = await front.request.get('http://127.0.0.1:3010/api/memberships');
  assert.equal(publicCatalog.status(), 200);
  const savedPlan = (await publicCatalog.json()).plans.find(item => item.code === 'MONTHLY');
  assert.equal(savedPlan.priceCents, 123);
  assert.equal(savedPlan.benefits.find(item => item.key === 'DAILY_FREE_REPLIES').value, 5);
  await front.goto('http://127.0.0.1:3010/membership');
  await front.getByRole('heading', {name: 'E2E 月会员', exact: true}).waitFor();
  assert.equal(await front.getByText('¥1.23', {exact: true}).count(), 1);

  await admin.goto('http://127.0.0.1:3011/admin/finance');
  await admin.getByRole('button', {name: `查看订单 ${membershipFinance.used.paymentOrderNo}`}).click();
  await admin.getByText('¥29.00', {exact: true}).waitFor();
  await admin.getByText(`${membershipFinance.used.refundId} · 渠道退款号 mem-fin-refund-USED-20261023`, {exact: true}).waitFor();
  assert.equal(await admin.getByText('申请整单退款', {exact: true}).count(), 0, '会员订单不得展示金币整单退款按钮');
  assert.equal(await admin.getByText('批准并提交渠道', {exact: true}).count(), 0, '会员订单不得展示金币退款审批动作');
  assert.equal(await admin.getByText('会员退款金额按已使用权益周期计算，请在会员中心发起或查看退款。', {exact: true}).count(), 1);

  await front.goto('http://127.0.0.1:3010/login');
  await front.getByLabel(/邮箱/).fill(fixture.user.email);
  await front.getByRole('textbox', {name: '密码'}).fill(fixture.password);
  const userLoginResponse = front.waitForResponse(r => r.url().includes('/api/auth/login') && r.request().method() === 'POST');
  await front.getByRole('button', {name: /登录/}).click();
  assert.equal((await userLoginResponse).status(), 200);
  await front.goto('http://127.0.0.1:3010/profile');
  await front.getByText('E2E 表单资料', {exact: true}).waitFor();
  const adminSession = await front.request.get('http://127.0.0.1:3010/api/admin/auth/session', {headers: {Authorization: `Bearer ${token}`}});
  assert.equal(adminSession.status(), 401);
  console.log(JSON.stringify({adminLogin: true, frontendCannotUseAdminSession: true, isolatedDatabase: true,
    sidebarPersistence: true, profileFormSave: true, profileApiPropagation: true, profileDomRender: true, membershipCatalogUiSave: true,
    membershipFrontendRender: true, membershipFinanceDrawerRefund: true, membershipFinanceNoCoinActions: true,
    publicPageProjections: true, operationsMigrationCheck: true}));
} finally {
  try { await browser?.close(); }
  finally { try { await stopChildren(); } finally { await fixture?.cleanup(); } }
}
