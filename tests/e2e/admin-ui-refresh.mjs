import {strict as assert} from 'node:assert';
import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

/**
 * Visual/interaction acceptance for the refreshed admin shell.
 *
 * This intentionally exercises only isolated production services. It does not
 * call checkout, task execution, backup, restore, maintenance, or merchant
 * mutation endpoints. Screenshots and the JSON report are runtime artifacts;
 * keep them outside git with ADMIN_UI_ARTIFACTS when running locally/CI.
 *
 * Run after the normal production build:
 *   node tests/e2e/admin-ui-refresh.mjs
 */
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
if (process.env.DATABASE_URL) throw Error('E2E refuses an external DATABASE_URL; it owns its isolated fixture.');

const root = fileURLToPath(new URL('../..', import.meta.url));
const webOrigin = 'http://127.0.0.1:3010';
const adminOrigin = 'http://127.0.0.1:3011';
const apiOrigin = 'http://127.0.0.1:3012';
const artifacts = path.resolve(process.env.ADMIN_UI_ARTIFACTS || path.join(root, 'artifacts', 'admin-ui'));
mkdirSync(artifacts, {recursive: true});

// Import the single source of truth instead of maintaining a second hard-coded
// route list. The 25 business entries plus the independent login screen make
// the 26-page acceptance surface.
const {ADMIN_NAV} = await import('@rumiai/contracts/admin/nav');
const ADMIN_BUSINESS_ROUTES = ADMIN_NAV.flatMap(group => group.entries.map(entry => [entry.href, entry.label]));
const ADMIN_NAV26 = [['/admin/login', '管理员登录'], ...ADMIN_BUSINESS_ROUTES];
assert.equal(ADMIN_BUSINESS_ROUTES.length, 25);
assert.equal(ADMIN_NAV26.length, 26);

const children = [];
let fixture;
let browser;
let seededContent;
const failures = [];
const httpErrors = [];
const pages = [];
const report = {generatedAt: new Date().toISOString(), artifacts, navCount: ADMIN_NAV26.length, routes: [], interactions: {}, controlSummary: {passed: 0, failed: 0, untested: 0, notImplemented: 3}, knownNotImplemented: [
  {route: '/admin/accounts', control: '新增网站账户', reason: '当前只支持查找、停用、恢复和撤销已有账户会话。'},
  {route: '/admin/accounts', control: '后台关闭网站账户', reason: '当前只有用户自助关闭流程。'},
  {route: '/admin/memberships', control: '新增/删除会员方案', reason: '当前页面仅编辑已有方案和退款规则。'},
], uncovered: [
  '未执行真实会员购买、退款、充值、支付商户验证。',
  '未执行后台任务、备份、恢复、维护模式、证书续签等危险运维动作。',
  '除本测试明确覆盖的管理员角色生命周期外，其余栏目业务写入仍需专门数据流验收。',
]};

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
    if (failed) throw Error(`E2E service exited before readiness: ${failed.output}`);
    try { if ((await fetch(url, {signal: AbortSignal.timeout(2000)})).status < 500) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error(`Service not ready: ${url}\n${children.map(child => child.output).join('\n')}`);
}

function slug(route) { return route.replace(/^\/admin\/?/, '').replaceAll('/', '-') || 'overview'; }

function attachDiagnostics(page, label) {
  pages.push({page, label});
  page.on('pageerror', error => failures.push({kind: 'pageerror', label, url: page.url(), message: String(error?.stack || error)}));
  page.on('console', message => {
    if (message.type() === 'error') failures.push({kind: 'console.error', label, url: page.url(), message: message.text()});
  });
  page.on('response', response => {
    if (response.status() >= 400) httpErrors.push({kind: 'http', label, url: page.url(), responseUrl: response.url(), status: response.status(), method: response.request().method()});
  });
}

async function measureLayout(page) {
  return page.evaluate(() => {
    const regions = [document.documentElement, document.body, document.querySelector('.admin-workspace'), document.querySelector('main')].filter(Boolean);
    return {
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      regions: regions.map(node => ({name: node.className || node.tagName, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth})),
      overflowing: regions.some(node => node.scrollWidth > node.clientWidth + 1),
    };
  });
}

async function waitForPage(page, route, {authenticated = true} = {}) {
  await page.goto(adminOrigin + route, {waitUntil: 'domcontentloaded'});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(250);
  if (authenticated) assert.match(page.url(), /127\.0\.0\.1:3011\/admin(?!\/login)/);
  const h1 = (await page.locator('h1').allTextContents()).join(' ').trim();
  assert.ok(h1, `${route} did not render an h1`);
  const tabs = await page.locator('[role="tab"]').allTextContents();
  const overflow = await measureLayout(page);
  assert.equal(overflow.overflowing, false, `${route} has horizontal overflow at ${overflow.viewport}px (${overflow.document}/${overflow.body})`);
  return {h1, tabs, overflow};
}

async function exerciseTabs(page, route) {
  const tabs = page.locator('[role="tab"]');
  const count = await tabs.count();
  const visited = [];
  for (let index = 0; index < count; index++) {
    const tab = tabs.nth(index);
    const label = (await tab.innerText()).trim();
    await tab.click();
    await page.waitForTimeout(100);
    assert.equal(await tab.getAttribute('aria-selected'), 'true', `${route} tab ${label} did not become active`);
    const controls = await tab.getAttribute('aria-controls');
    if (controls) {
      assert.equal(await page.locator(`id=${controls}`).isVisible(), true, `${route} tab ${label} panel is not visible`);
    } else {
      assert.ok((await page.locator('main').innerText()).trim().length > 0, `${route} tab ${label} has no visible section content`);
    }
    visited.push(label);
  }
  return visited;
}

async function inventoryMainControls(page, passedTabs) {
  return page.locator('main button, main input, main textarea, main select, main a[href]').evaluateAll((nodes, passed) => nodes
    .filter(node => {
      const element = node;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    })
    .map((node, index) => {
      const element = node;
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : 'field');
      const id = element.getAttribute('id');
      const explicitLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : '';
      const wrappingLabel = element.closest('label')?.textContent;
      const label = (element.getAttribute('aria-label') || explicitLabel || wrappingLabel || element.textContent || element.getAttribute('placeholder') || element.getAttribute('name') || `${tag}-${index}`).trim().replace(/\s+/g, ' ').slice(0, 180);
      const disabled = 'disabled' in element && Boolean(element.disabled);
      const passedControl = role === 'tab' && passed.includes(label);
      return {kind: role, label, disabled, status: passedControl ? '已通过' : '未测'};
    }), passedTabs);
}

async function assertOverflowForRoutes(page, viewport, report) {
  await page.setViewportSize(viewport);
  for (const [route, expectedLabel] of ADMIN_BUSINESS_ROUTES) {
    try {
      const snapshot = await waitForPage(page, route);
      const beforeTabs = path.join(artifacts, `${slug(route)}-${viewport.width}x${viewport.height}-before-tabs.png`);
      await page.screenshot({path: beforeTabs, fullPage: true});
      const visitedTabs = await exerciseTabs(page, route);
      const afterTabOverflow = await measureLayout(page);
      assert.equal(afterTabOverflow.overflowing, false, `${route} has horizontal overflow after tab interactions at ${afterTabOverflow.viewport}px`);
      const afterTabs = path.join(artifacts, `${slug(route)}-${viewport.width}x${viewport.height}-after-tabs.png`);
      await page.screenshot({path: afterTabs, fullPage: true});
      const controls = await inventoryMainControls(page, visitedTabs);
      report.controlSummary.passed += controls.filter(control => control.status === '已通过').length;
      report.controlSummary.untested += controls.filter(control => control.status === '未测').length;
      console.log(`[admin-ui] checkpoint ${viewport.width}x${viewport.height} ${route} h1=${JSON.stringify(snapshot.h1)} tabs=${visitedTabs.length}`);
      report.routes.push({route, expectedLabel, viewport, h1: snapshot.h1, tabs: snapshot.tabs, tabsVisited: visitedTabs, controls, overflowBeforeTabs: snapshot.overflow, overflowAfterTabs: afterTabOverflow, screenshots: {beforeTabs, afterTabs}});
    } catch (error) {
      const file = path.join(artifacts, `${slug(route)}-${viewport.width}x${viewport.height}-failure.png`);
      let screenshotError;
      try { await page.screenshot({path: file, fullPage: true}); }
      catch (captureError) { screenshotError = String(captureError?.stack || captureError); }
      report.routes.push({route, expectedLabel, viewport, error: String(error?.stack || error), screenshot: file, screenshotError});
      report.controlSummary.failed += 1;
      throw error;
    }
  }
}

async function seedMembershipFixture() {
  await fixture.db.user.update({where: {id: fixture.user.id}, data: {inviteCode: 'E2EINV01'}});
  for (const [key, value] of [
    ['growth.inviteEnabled', 'true'],
    ['growth.onboardingEnabled', 'true'],
  ]) {
    await fixture.db.operationSetting.create({data: {key, group: 'growth', value, updatedBy: fixture.admin.id}});
  }
  const plans = [
    ['MONTHLY', 'E2E 月度会员', 30, 100],
    ['QUARTERLY', 'E2E 季度会员', 90, 270],
    ['YEARLY', 'E2E 年度会员', 365, 900],
  ];
  for (const [code, name, durationDays, priceCents] of plans) {
    await fixture.db.membershipPlan.upsert({
      where: {code},
      update: {name, durationDays, priceCents, isActive: true, benefitsJson: JSON.stringify([{key: 'DAILY_FREE_REPLIES', label: '每日额外免费回复', value: 5}])},
      create: {code, name, durationDays, priceCents, isActive: true, sortOrder: plans.findIndex(item => item[0] === code), benefitsJson: JSON.stringify([{key: 'DAILY_FREE_REPLIES', label: '每日额外免费回复', value: 5}])},
    });
  }
  await fixture.db.membershipPolicy.upsert({where: {id: 'primary'}, update: {refundWindowHours: 24, usageChargePeriodHours: 24}, create: {id: 'primary', refundWindowHours: 24, usageChargePeriodHours: 24, version: 1}});
  const contentUsers = [];
  // Fixture already contains the administrator and one ordinary user; add six
  // content users so the isolated database has eight users in total.
  for (let index = 1; index <= 6; index++) {
    contentUsers.push(await fixture.db.user.create({data: {
      username: `e2e-content-${index}`,
      email: `e2e-content-${index}@example.test`,
      passwordHash: 'fixture-only-no-login',
      displayName: `内容用户 ${index}`,
      coins: 100 + index,
    }}));
  }
  const character = await fixture.db.character.create({data: {
    name: 'E2E 视觉角色', tagline: '用于后台详情验收的角色', personality: '温和、清晰、善于解释。',
    background: '仅用于隔离浏览器视觉验收。', greeting: '你好，这是验收数据。', scenario: '后台详情抽屉验收',
    roleTemplate: '保持友好并给出结构化回答。', tags: 'e2e,ui', creatorId: fixture.user.id, isPublic: true, reviewStatus: 'APPROVED',
  }});
  const circle = await fixture.db.circle.create({data: {
    name: 'E2E 验收圈子', description: '用于后台圈子详情验收的隔离圈子。', tags: 'e2e,ui', ownerId: fixture.user.id, status: 'ACTIVE', isFeatured: false,
  }});
  await fixture.db.circleMember.create({data: {circleId: circle.id, userId: fixture.user.id}});
  const post = await fixture.db.post.create({data: {circleId: circle.id, authorId: contentUsers[0].id, characterId: character.id, content: 'E2E 后台帖子详情内容。', status: 'VISIBLE'}});
  const comment = await fixture.db.postComment.create({data: {postId: post.id, authorId: contentUsers[1].id, content: 'E2E 后台评论详情内容。', status: 'VISIBLE'}});
  seededContent = {contentUsers, character, circle, post, comment};
}

try {
  fixture = await createFixture();
  await seedMembershipFixture();
  await fixture.disconnect();

  const env = {...process.env,
    DATABASE_URL: `file:${fixture.dbPath.replaceAll('\\', '/')}`,
    BACKUPS_DIRECTORY: path.join(fixture.dir, 'backups'), UPLOADS_DIRECTORY: path.join(fixture.dir, 'uploads'),
    INTERNAL_API_ORIGIN: apiOrigin, ADMIN_API_INTERNAL_URL: apiOrigin,
    INTERNAL_ADMIN_ORIGIN: adminOrigin, ADMIN_PUBLIC_ORIGIN: adminOrigin,
    NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'production',
    JWT_SECRET: 'e2e-admin-ui-refresh-secret-012345678901234567890123', NEXT_PUBLIC_SITE_URL: webOrigin,
    EZFP_ENABLED: 'false', EZFP_REFUNDS_ENABLED: 'false', EZFP_PID: '',
    EZFP_MERCHANT_PRIVATE_KEY: '', EZFP_PLATFORM_PUBLIC_KEY: '', AI_API_KEY: '', OPENAI_API_KEY: '',
  };
  for (const [app, port] of [['api', 3012], ['admin', 3011], ['web', 3010]]) start(app, port, env);
  await waitForService(`${adminOrigin}/admin/login`);
  await waitForService(`${webOrigin}/login`);

  browser = await chromium.launch({headless: true});
  const admin = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const front = await browser.newPage({viewport: {width: 1440, height: 1000}});
  attachDiagnostics(admin, 'admin-shell');
  attachDiagnostics(front, 'web-shell');

  // Exercise the actual invite link -> registration request -> persisted attribution ->
  // onboarding gate -> skip -> intended destination journey in the isolated browser.
  await front.goto(`${webOrigin}/register?invite=e2einv01&next=%2Fdiscover`, {waitUntil: 'domcontentloaded'});
  await front.getByRole('status').getByText(/E2EINV01/).waitFor({state: 'visible'});
  await front.getByPlaceholder('username123').fill('e2e-invited-user');
  await front.getByPlaceholder('your@email.com').fill('e2e-invited-user@example.test');
  await front.locator('input[type="password"]').fill(fixture.password);
  const registrationResponse = front.waitForResponse(response => response.url().includes('/api/auth/register') && response.request().method() === 'POST');
  await front.getByRole('button', {name: '免费注册 🎉'}).click();
  assert.equal((await registrationResponse).status(), 201);
  await front.waitForURL('**/onboarding?next=%2Fdiscover');
  await front.getByRole('heading', {name: '欢迎来到星伴'}).waitFor({state: 'visible'});
  const onboardingResponse = front.waitForResponse(response => response.url().includes('/api/growth/onboarding') && response.request().method() === 'POST');
  await front.getByRole('button', {name: '跳过引导'}).click();
  assert.equal((await onboardingResponse).status(), 200);
  await front.waitForURL('**/discover');
  const invitedAccount = await fixture.db.user.findUnique({where: {email: 'e2e-invited-user@example.test'}, select: {invitedByUserId: true, onboardedAt: true}});
  assert.equal(invitedAccount?.invitedByUserId, fixture.user.id);
  assert.ok(invitedAccount?.onboardedAt);
  report.interactions.inviteRegistrationOnboarding = {inviteCodeVisible: true, registration: true, attributionPersisted: true, onboardingEntered: true, skipPersisted: true, returnedToNext: true};

  // Login is independent from the authenticated 25-entry business navigation.
  for (const viewport of [{width: 1440, height: 1000}, {width: 390, height: 844}]) {
    await admin.setViewportSize(viewport);
    const snapshot = await waitForPage(admin, '/admin/login', {authenticated: false});
    const file = path.join(artifacts, `admin-login-${viewport.width}x${viewport.height}.png`);
    await admin.screenshot({path: file, fullPage: true});
    report.routes.push({route: '/admin/login', expectedLabel: '管理员登录', viewport, h1: snapshot.h1, tabs: snapshot.tabs, overflow: snapshot.overflow, screenshot: file});
  }
  await admin.setViewportSize({width: 1440, height: 1000});
  await admin.goto(`${adminOrigin}/admin/login`, {waitUntil: 'domcontentloaded'});
  await admin.getByLabel('登录邮箱').waitFor({state: 'visible'});
  await admin.getByLabel('登录邮箱').fill(fixture.admin.email);
  await admin.getByLabel('密码').fill(fixture.password);
  const loginResponse = admin.waitForResponse(response => response.url().includes('/api/admin/auth/login') && response.request().method() === 'POST');
  await admin.getByRole('button', {name: '登录管理中心'}).click();
  assert.equal((await loginResponse).status(), 200);
  await admin.waitForURL('**/admin');
  await admin.locator('h1').filter({hasText: /管理中心|工作台|概览/}).waitFor({state: 'visible'});
  await admin.getByRole('button', {name: '搜索后台栏目'}).waitFor({state: 'visible'});

  // Navigation search must return a real route, not just render an inert popup.
  await admin.getByRole('button', {name: '搜索后台栏目'}).click();
  const searchRegion = admin.getByRole('region', {name: '栏目快捷搜索'});
  await searchRegion.getByLabel('输入栏目名称').fill('会员');
  await searchRegion.getByRole('link', {name: /会员方案/}).click();
  await admin.waitForURL('**/admin/memberships');
  await admin.getByRole('heading', {name: '会员方案', exact: true}).waitFor({state: 'visible'});
  await admin.getByText('退款与扣费规则', {exact: true}).waitFor({state: 'visible'});
  assert.match(admin.url(), /\/admin\/memberships$/);
  report.interactions.navigationSearch = true;

  // Group expand/collapse and rail state persist through reload.
  const groupButton = admin.getByRole('button', {name: /AI 平台/});
  await groupButton.waitFor({state: 'visible'});
  const beforeExpanded = await groupButton.getAttribute('aria-expanded');
  assert.ok(beforeExpanded === 'true' || beforeExpanded === 'false');
  const toggledExpanded = beforeExpanded === 'true' ? 'false' : 'true';
  await groupButton.click();
  await admin.waitForFunction(expected => [...document.querySelectorAll('button.admin-nav-group')].find(node => node.textContent?.includes('AI 平台'))?.getAttribute('aria-expanded') === expected, toggledExpanded);
  assert.equal(await groupButton.getAttribute('aria-expanded'), toggledExpanded);
  await groupButton.click();
  await admin.waitForFunction(expected => [...document.querySelectorAll('button.admin-nav-group')].find(node => node.textContent?.includes('AI 平台'))?.getAttribute('aria-expanded') === expected, beforeExpanded);
  await admin.goto(`${adminOrigin}/admin/accounts`);
  await admin.getByTitle('收起侧栏').click();
  assert.equal(await admin.evaluate(() => localStorage.getItem('admin.sidebar.collapsed')), '1');
  await admin.reload();
  assert.equal(await admin.evaluate(() => localStorage.getItem('admin.sidebar.collapsed')), '1');
  report.interactions.groupToggleAndSidebarPersistence = true;

  // The user detail keeps a wide two-column layout on desktop and a drawer on mobile.
  await admin.getByTitle('展开侧栏').click();
  await admin.getByLabel('搜索用户').fill(fixture.user.email);
  await admin.getByRole('button', {name: '搜索用户'}).click();
  const userOpenButton = admin.getByRole('button', {name: `查看用户 ${fixture.user.username}`});
  await userOpenButton.click();
  const detail = admin.getByRole('dialog', {name: /用户详情/});
  await detail.waitFor({state: 'visible'});
  await detail.getByRole('tab', {name: '基本资料'}).click();
  const nicknameInput = detail.getByLabel('昵称').last();
  await nicknameInput.fill('E2E 未保存昵称');
  await detail.getByRole('tab', {name: '会员与资产'}).click();
  await detail.getByRole('tab', {name: '基本资料'}).click();
  assert.equal(await nicknameInput.inputValue(), 'E2E 未保存昵称');
  assert.equal(await admin.locator('[data-admin-shell]').evaluate(node => node.inert), true);
  const desktopDetailWidth = await detail.evaluate(node => node.getBoundingClientRect().width);
  assert.ok(desktopDetailWidth > 600, `desktop detail drawer should be wide enough for split content, got ${desktopDetailWidth}`);
  const userDesktopShot = path.join(artifacts, 'users-detail-desktop.png');
  await admin.screenshot({path: userDesktopShot, fullPage: true});
  await admin.once('dialog', dialog => dialog.dismiss());
  await detail.getByRole('button', {name: '关闭详情'}).click();
  await detail.waitFor({state: 'visible'});
  assert.equal(await nicknameInput.inputValue(), 'E2E 未保存昵称');
  await admin.once('dialog', dialog => dialog.accept());
  await detail.getByRole('button', {name: '关闭详情'}).click();
  await detail.waitFor({state: 'hidden'});
  assert.equal(await admin.locator('[data-admin-shell]').evaluate(node => node.inert), false);
  assert.equal(await admin.evaluate(() => document.activeElement?.getAttribute('aria-label')), `查看用户 ${fixture.user.username}`);
  await admin.setViewportSize({width: 390, height: 844});
  await admin.getByRole('button', {name: `查看用户 ${fixture.user.username}`}).click();
  const mobileDetail = admin.getByRole('dialog', {name: /用户详情/});
  await mobileDetail.waitFor({state: 'visible'});
  const mobileDetailWidth = await mobileDetail.evaluate(node => node.getBoundingClientRect().width);
  assert.ok(Math.abs(mobileDetailWidth - 390) < 1, `mobile detail drawer should use the full viewport, got ${mobileDetailWidth}`);
  const userMobileShot = path.join(artifacts, 'users-detail-mobile.png');
  await admin.screenshot({path: userMobileShot, fullPage: true});
  report.interactions.userDetailDesktopAndMobile = {desktopDetailWidth, mobileDetailWidth, screenshots: {desktop: userDesktopShot, mobile: userMobileShot}, dirtyCancelAndAccept: true, inertAndFocusRestore: true};
  await mobileDetail.getByRole('button', {name: '关闭详情'}).click();
  await mobileDetail.waitFor({state: 'hidden'});

  // Seeded character/circle records must open real GET-backed drawers. Exercise
  // dirty close cancellation and acceptance without submitting a new draft.
  await admin.setViewportSize({width: 1440, height: 1000});
  await admin.goto(`${adminOrigin}/admin/characters`);
  await admin.getByPlaceholder('名称、简介或角色编号').fill(seededContent.character.name);
  await admin.getByRole('button', {name: '搜索角色'}).click();
  await admin.getByRole('button', {name: `查看角色 ${seededContent.character.name}`}).click();
  const characterDialog = admin.getByRole('dialog', {name: /角色详情/});
  await characterDialog.waitFor({state: 'visible'});
  await characterDialog.getByRole('status').getByText('正在读取角色详情…', {exact: true}).waitFor({state: 'hidden'});
  await characterDialog.getByLabel('角色名称').fill('E2E 未保存角色');
  assert.equal(await characterDialog.getByLabel('角色名称').inputValue(), 'E2E 未保存角色', 'an initial ui-config request must not impose maxLength=0');
  await admin.once('dialog', dialog => dialog.dismiss());
  await characterDialog.getByRole('button', {name: '关闭详情'}).last().click();
  await characterDialog.waitFor({state: 'visible'});
  assert.equal(await characterDialog.getByLabel('角色名称').inputValue(), 'E2E 未保存角色');
  const characterShot = path.join(artifacts, 'character-detail-desktop.png');
  await admin.screenshot({path: characterShot, fullPage: true});
  await admin.once('dialog', dialog => dialog.accept());
  await characterDialog.getByRole('button', {name: '关闭详情'}).last().click();
  await characterDialog.waitFor({state: 'hidden'});
  report.interactions.characterDetailDrawer = {screenshot: characterShot, dirtyCancelAndAccept: true};

  await admin.goto(`${adminOrigin}/admin/circles`);
  await admin.getByLabel('搜索管理圈子').fill(seededContent.circle.name);
  await admin.getByRole('button', {name: '搜索圈子'}).click();
  await admin.getByRole('button', {name: `查看圈子 ${seededContent.circle.name}`}).click();
  const circleDialog = admin.getByRole('dialog', {name: /圈子详情/});
  await circleDialog.waitFor({state: 'visible'});
  await circleDialog.getByRole('status').getByText('正在读取圈子详情…', {exact: true}).waitFor({state: 'hidden'});
  await circleDialog.getByLabel('管理圈子名称').fill('E2E 未保存圈子');
  await admin.once('dialog', dialog => dialog.dismiss());
  await circleDialog.getByRole('button', {name: '关闭详情'}).last().click();
  await circleDialog.waitFor({state: 'visible'});
  assert.equal(await circleDialog.getByLabel('管理圈子名称').inputValue(), 'E2E 未保存圈子');
  await admin.once('dialog', dialog => dialog.accept());
  await circleDialog.getByRole('button', {name: '关闭详情'}).last().click();
  await circleDialog.waitFor({state: 'hidden'});
  report.interactions.circleDetailDrawer = {dirtyCancelAndAccept: true};

  // Post/comment drawers are read-only checks; no moderation action is clicked.
  await admin.goto(`${adminOrigin}/admin/community/posts`);
  await admin.getByPlaceholder('内容、作者、圈子或帖子编号').fill(seededContent.post.content);
  await admin.getByRole('button', {name: '搜索', exact: true}).click();
  await admin.getByRole('button', {name: '查看详情'}).first().click();
  const postDialog = admin.getByRole('dialog', {name: '帖子详情'});
  await postDialog.waitFor({state: 'visible'});
  await postDialog.getByText(seededContent.post.content, {exact: true}).waitFor();
  await postDialog.getByRole('button', {name: '关闭详情'}).click();
  await postDialog.waitFor({state: 'hidden'});

  await admin.goto(`${adminOrigin}/admin/community/comments`);
  await admin.getByPlaceholder('评论、作者、帖子编号或圈子').fill(seededContent.comment.content);
  await admin.getByRole('button', {name: '搜索', exact: true}).click();
  await admin.getByRole('button', {name: '查看详情'}).first().click();
  const commentDialog = admin.getByRole('dialog', {name: '评论详情'});
  await commentDialog.waitFor({state: 'visible'});
  await commentDialog.getByText(seededContent.comment.content, {exact: true}).waitFor();
  await commentDialog.getByRole('button', {name: '关闭详情'}).click();
  await commentDialog.waitFor({state: 'hidden'});
  report.interactions.postAndCommentReadOnlyDrawers = true;

  // The admin provider uses rumiai-admin-theme; a legacy/shared theme key must
  // remain untouched even when the admin toggle switches to dark mode.
  await front.goto(`${webOrigin}/`, {waitUntil: 'domcontentloaded'});
  await admin.evaluate(() => localStorage.setItem('theme', 'light'));
  await admin.getByRole('button', {name: '深色'}).click();
  assert.equal(await admin.evaluate(() => localStorage.getItem('rumiai-admin-theme')), 'dark');
  assert.equal(await admin.evaluate(() => localStorage.getItem('theme')), 'light');
  await admin.getByRole('button', {name: '浅色'}).click();
  report.interactions.themeStorageIsolation = true;

  // Unsaved membership input survives switching between plan sections/tabs.
  await admin.goto(`${adminOrigin}/admin/memberships`);
  const monthlyTab = admin.getByRole('tab', {name: /E2E 月度会员/});
  const quarterlyTab = admin.getByRole('tab', {name: /E2E 季度会员/});
  await monthlyTab.click();
  const monthlyPrice = admin.getByLabel('方案价格（分）');
  const originalMonthlyPrice = await monthlyPrice.inputValue();
  const membershipShot = path.join(artifacts, 'membership-monthly-plan.png');
  await admin.screenshot({path: membershipShot, fullPage: true});
  await monthlyPrice.fill('177');
  await quarterlyTab.click();
  await monthlyTab.click();
  assert.equal(await monthlyPrice.inputValue(), '177');
  await monthlyPrice.fill(originalMonthlyPrice);
  report.interactions.membershipDraftSurvivesTabSwitch = {screenshot: membershipShot};

  // Full isolated operator lifecycle: create a least-privilege role, assign it to an
  // existing account, prove allowed/denied access, verify assigned-role deletion guard,
  // then disable the identity and prove its live admin session was revoked before cleanup.
  await admin.goto(`${adminOrigin}/admin/operators`);
  await admin.getByRole('heading', {name: '管理员与角色', exact: true}).waitFor({state: 'visible'});
  await admin.getByLabel('角色名称').fill('E2E 运营只读');
  const permissionSearch = admin.getByLabel('搜索业务权限');
  await permissionSearch.fill('analytics.read');
  const permissionFieldset = admin.locator('fieldset').filter({has: permissionSearch});
  await permissionFieldset.getByRole('checkbox').check();
  await admin.getByLabel('修改理由').fill('E2E 创建最小权限角色');
  await admin.getByRole('button', {name: '保存角色', exact: true}).click();
  await admin.getByText('角色已保存，权限立即生效。', {exact: true}).waitFor({state: 'visible'});

  async function selectFixtureOperator() {
    await admin.getByText('正在读取管理人员…', {exact: true}).waitFor({state: 'hidden'}).catch(() => {});
    await admin.waitForTimeout(300);
    const lookup = admin.getByPlaceholder('完整用户名或登录邮箱');
    await lookup.waitFor({state: 'visible'});
    await lookup.fill(fixture.user.email);
    await admin.getByRole('button', {name: '查找账号', exact: true}).click();
    await admin.getByText(new RegExp(`正在编辑：${fixture.user.username}`)).waitFor({state: 'visible'});
  }
  await selectFixtureOperator();
  await admin.getByLabel('E2E 运营只读', {exact: true}).check();
  await admin.getByLabel('操作理由').fill('E2E 绑定只读角色');
  await admin.getByRole('button', {name: '保存管理身份', exact: true}).click();
  await admin.getByText('管理身份已保存。', {exact: true}).waitFor({state: 'visible'});

  const limitedContext = await browser.newContext({viewport: {width: 1280, height: 900}});
  const limited = await limitedContext.newPage();
  await limited.goto(`${adminOrigin}/admin/login`);
  await limited.getByLabel('登录邮箱').fill(fixture.user.email);
  await limited.getByLabel('密码').fill(fixture.password);
  await limited.getByRole('button', {name: '登录管理中心'}).click();
  await limited.waitForURL('**/admin');
  await limited.goto(`${adminOrigin}/admin/analytics`);
  await limited.getByRole('heading', {name: '运营分析', exact: true}).waitFor({state: 'visible'});
  assert.equal((await limited.request.get(`${adminOrigin}/api/admin/operators`)).status(), 403, 'analytics-only role must not read operator management');

  const assignedRoleCard = admin.locator('article').filter({has: admin.getByRole('heading', {name: 'E2E 运营只读', exact: true})});
  await assignedRoleCard.getByRole('button', {name: '删除 / 查看原因'}).click();
  const assignedDeleteDialog = admin.getByRole('dialog', {name: '删除自定义管理角色'});
  await assignedDeleteDialog.getByText(/仍分配给 1 个管理账号/).waitFor({state: 'visible'});
  assert.equal(await assignedDeleteDialog.getByRole('button', {name: '确认删除'}).isDisabled(), true);
  await assignedDeleteDialog.getByRole('button', {name: '取消'}).click();

  await selectFixtureOperator();
  await admin.getByLabel('启用管理身份').uncheck();
  await admin.getByLabel('E2E 运营只读', {exact: true}).uncheck();
  await admin.getByLabel('操作理由').fill('E2E 停用并回收角色');
  await admin.getByRole('button', {name: '保存管理身份', exact: true}).click();
  await admin.getByText('管理身份已保存。', {exact: true}).waitFor({state: 'visible'});
  assert.equal((await limited.request.get(`${adminOrigin}/api/admin/auth/session`)).status(), 401, 'disabling an operator must revoke its existing admin session');
  await limitedContext.close();

  const unassignedRoleCard = admin.locator('article').filter({has: admin.getByRole('heading', {name: 'E2E 运营只读', exact: true})});
  await unassignedRoleCard.getByRole('button', {name: '删除 / 查看原因'}).click();
  const deleteDialog = admin.getByRole('dialog', {name: '删除自定义管理角色'});
  await deleteDialog.getByLabel('删除理由').fill('E2E 清理未分配测试角色');
  await deleteDialog.getByRole('button', {name: '确认删除'}).click();
  await admin.getByText('未分配的自定义角色已删除。', {exact: true}).waitFor({state: 'visible'});
  report.interactions.operatorLifecycle = {
    createRole: true, assignExistingAccount: true, allowedAnalytics: true, deniedOperatorRead: true,
    assignedDeleteGuard: true, disableAndUnassign: true, sessionRevoked: true, deleteAfterUnassign: true,
  };

  // Explicitly verify checkout remains disabled; this is a read-only GET.
  const checkout = await admin.request.get(`${adminOrigin}/api/admin/payments/checkout`);
  assert.equal(checkout.status(), 200);
  const checkoutPolicy = await checkout.json();
  assert.equal(checkoutPolicy.enabled, false, 'real checkout must remain disabled in UI acceptance fixture');
  report.interactions.checkoutEnabled = checkoutPolicy.enabled;

  await admin.setViewportSize({width: 1440, height: 1000});
  await assertOverflowForRoutes(admin, {width: 1440, height: 1000}, report);
  await assertOverflowForRoutes(admin, {width: 390, height: 844}, report);
  report.pageErrors = failures;
  report.httpErrors = httpErrors;
  assert.equal(failures.length, 0, `admin UI emitted browser errors: ${JSON.stringify(failures)}`);
  writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ok: true, navCount: report.navCount, routeSnapshots: report.routes.length, artifacts, interactions: report.interactions, uncovered: report.uncovered}));
} catch (error) {
  report.pageErrors = failures;
  report.httpErrors = httpErrors;
  report.error = String(error?.stack || error);
  const currentAdmin = pages.find(entry => entry.label === 'admin-shell');
  if (currentAdmin) {
    const currentFile = path.join(artifacts, `failure-current-admin-${Date.now()}.png`);
    try {
      await currentAdmin.page.screenshot({path: currentFile, fullPage: true});
      report.currentAdminScreenshot = currentFile;
    } catch (captureError) {
      report.currentAdminScreenshotError = String(captureError?.stack || captureError);
    }
  }
  report.uncovered.push('本次运行在首个失败点停止；report.routes 之前已记录的入口才算实际走过，未记录入口不能视为验收通过。');
  writeFileSync(path.join(artifacts, 'report.failed.json'), JSON.stringify(report, null, 2));
  throw error;
} finally {
  try { await browser?.close(); }
  finally { try { await stopChildren(); } finally { await fixture?.cleanup(); } }
}
