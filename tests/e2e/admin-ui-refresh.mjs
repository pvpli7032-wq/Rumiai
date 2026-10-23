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
const report = {generatedAt: new Date().toISOString(), artifacts, navCount: ADMIN_NAV26.length, routes: [], interactions: {}, operationMatrix: [], controlSummary: {passed: 0, failed: 0, untested: 0, notImplemented: 3}, knownNotImplemented: [
  {route: '/admin/accounts', control: '新增网站账户', reason: '当前只支持查找、停用、恢复和撤销已有账户会话。'},
  {route: '/admin/accounts', control: '后台关闭网站账户', reason: '当前只有用户自助关闭流程。'},
  {route: '/admin/memberships', control: '新增/删除会员方案', reason: '当前页面仅编辑已有方案和退款规则。'},
], uncovered: [
  '未执行真实会员购买、退款、充值、支付商户验证。',
  '未执行后台任务、备份、恢复、维护模式、证书续签等危险运维动作。',
  '本报告按 operationMatrix 列出已做 UI→API→数据库验收的唯一业务操作；未列出的财务订单/退款/对账与运维操作仍需逐组补测，不能由路由快照推定通过。',
]};

function recordOperation(route, operation, details) {
  report.operationMatrix.push({route, operation, ...details});
}

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
  const moderationReport = await fixture.db.report.create({data: {reporterId: contentUsers[2].id, targetType: 'USER', targetId: contentUsers[3].id, category: 'harassment', details: 'E2E 举报封禁与解封验收。'}});
  await fixture.db.user.update({where: {id: contentUsers[4].id}, data: {communityBannedAt: new Date(), communityBanReason: 'E2E 申诉前置封禁'}});
  const moderationAppeal = await fixture.db.communityAppeal.create({data: {userId: contentUsers[4].id, reason: 'E2E 社区封禁申诉验收。'}});
  seededContent = {contentUsers, character, circle, post, comment, moderationReport, moderationAppeal};
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
  const registrationWrites=[];
  const countRegistrationWrite=request=>{if(request.url().includes('/api/auth/register')&&request.method()==='POST')registrationWrites.push(request);};
  front.on('request',countRegistrationWrite);
  const registrationResponse = front.waitForResponse(response => response.url().includes('/api/auth/register') && response.request().method() === 'POST');
  await front.getByRole('button', {name: '免费注册 🎉'}).evaluate(button=>{button.click();button.click();});
  const registrationResult=await registrationResponse;
  assert.equal(registrationResult.status(),201,`registration failed: ${await registrationResult.text()}`);
  await front.waitForTimeout(200);front.off('request',countRegistrationWrite);assert.equal(registrationWrites.length,1,'synchronous duplicate registration must produce one POST');
  await front.waitForURL('**/onboarding?next=%2Fdiscover');
  await front.getByRole('heading', {name: '欢迎来到星伴'}).waitFor({state: 'visible'});
  const onboardingResponse = front.waitForResponse(response => response.url().includes('/api/growth/onboarding') && response.request().method() === 'POST');
  await front.getByRole('button', {name: '跳过引导'}).click();
  assert.equal((await onboardingResponse).status(), 200);
  await front.waitForURL('**/discover');
  const invitedAccount = await fixture.db.user.findUnique({where: {email: 'e2e-invited-user@example.test'}, select: {id: true, invitedByUserId: true, onboardedAt: true}});
  assert.equal(invitedAccount?.invitedByUserId, fixture.user.id);
  assert.ok(invitedAccount?.onboardedAt);
  report.interactions.inviteRegistrationOnboarding = {inviteCodeVisible: true, registration: true, attributionPersisted: true, onboardingEntered: true, skipPersisted: true, returnedToNext: true};

  // Media messages use the existing authenticated upload path but never invoke the
  // model in this test. Exercise the actual composer controls, persistence and reload.
  await front.goto(`${webOrigin}/chat?character=${encodeURIComponent(seededContent.character.id)}&new=1`, {waitUntil: 'domcontentloaded'});
  await front.getByLabel('选择 emoji').waitFor({state: 'visible'});
  await front.getByLabel('选择 emoji').click();
  await front.getByRole('button', {name: '😀'}).click();
  assert.equal(await front.locator('form input[type="text"]').inputValue(), '😀');
  await front.locator('form input[type="text"]').fill('');
  await front.getByLabel('选择表情包').click();
  const stickerWrites = [];
  const countSticker = request => { if (request.url().includes('/messages/attachments') && request.method() === 'POST') stickerWrites.push(request); };
  front.on('request', countSticker);
  const stickerResponse = front.waitForResponse(response => response.url().includes('/messages/attachments') && response.request().method() === 'POST');
  await front.getByRole('button', {name: '挥手'}).evaluate(button => {button.click(); button.click();});
  assert.equal((await stickerResponse).status(), 201);
  await front.waitForTimeout(200);
  front.off('request', countSticker);
  assert.equal(stickerWrites.length, 1);
  const mediaConversation = await fixture.db.conversation.findFirstOrThrow({where: {userId: invitedAccount.id}, orderBy: {updatedAt: 'desc'}});
  await front.goto(`${webOrigin}/chat?conversation=${encodeURIComponent(mediaConversation.id)}`, {waitUntil: 'domcontentloaded'});
  await front.getByText('👋', {exact: true}).waitFor({state: 'visible'});
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await front.locator('input[type="file"]').setInputFiles({name: 'e2e-chat.png', mimeType: 'image/png', buffer: png});
  const imageResponse = front.waitForResponse(response => response.url().includes('/messages/attachments') && response.request().method() === 'POST');
  await front.getByRole('button', {name: '发送'}).click();
  assert.equal((await imageResponse).status(), 201);
  await front.getByRole('img', {name: '用户发送的图片'}).waitFor({state: 'visible'});
  await front.reload();
  await front.getByText('👋', {exact: true}).waitFor({state: 'visible'});
  await front.getByRole('img', {name: '用户发送的图片'}).waitFor({state: 'visible'});
  assert.equal(await fixture.db.messageAttachment.count({where: {message: {conversation: {userId: invitedAccount.id}}}}), 2);
  report.interactions.chatMedia = {emojiInserted: true, stickerPersisted: true, imageUploadedAndPersisted: true, duplicateStickerSuppressed: true, modelInvoked: false};

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

  // Settings: normal save, synchronous duplicate click suppression, reload persistence,
  // client-side validation, and an optimistic-concurrency failure caused by another write.
  await admin.goto(`${adminOrigin}/admin/settings?section=chat-input`);
  const maxMessageChars = admin.getByLabel('单条输入字数');
  await maxMessageChars.waitFor({state: 'visible'});
  await maxMessageChars.fill('4999');
  const settingsWrites = [];
  const countSettingWrite = request => {
    if (request.url().includes('/api/admin/settings') && request.method() === 'PATCH') settingsWrites.push(request);
  };
  admin.on('request', countSettingWrite);
  const firstSettingSave = admin.waitForResponse(response => response.url().includes('/api/admin/settings') && response.request().method() === 'PATCH');
  await admin.getByRole('button', {name: '保存本页'}).evaluate(button => { button.click(); button.click(); });
  assert.equal((await firstSettingSave).status(), 200);
  await admin.getByRole('button', {name: '保存本页'}).waitFor({state: 'hidden'});
  await admin.waitForTimeout(250);
  admin.off('request', countSettingWrite);
  assert.equal(settingsWrites.length, 1, 'a synchronous duplicate settings click must produce one PATCH');
  await admin.reload();
  await admin.getByLabel('单条输入字数').waitFor({state: 'visible'});
  assert.equal(await admin.getByLabel('单条输入字数').inputValue(), '4999');

  await admin.getByLabel('单条输入字数').fill('0');
  await admin.getByRole('button', {name: '保存本页'}).click();
  await admin.getByText('不能小于 1。', {exact: true}).waitFor({state: 'visible'});
  await admin.getByRole('button', {name: '放弃修改'}).click();
  assert.equal(await admin.getByLabel('单条输入字数').inputValue(), '4999');

  const settingsRead = await admin.request.get(`${adminOrigin}/api/admin/settings?group=chat`);
  assert.equal(settingsRead.status(), 200);
  const settingItems = (await settingsRead.json()).values;
  const currentSetting = settingItems.find(item => item.key === 'chat.maxMessageChars');
  const concurrentWrite = await admin.request.patch(`${adminOrigin}/api/admin/settings`, {data: {group: 'chat', changes: [{key: 'chat.maxMessageChars', value: 4998}], expectedVersions: {'chat.maxMessageChars': currentSetting.version}}});
  assert.equal(concurrentWrite.status(), 200);
  await admin.getByLabel('单条输入字数').fill('4997');
  await admin.getByRole('button', {name: '保存本页'}).click();
  await admin.getByRole('alert').filter({hasText: /其他管理员修改/}).first().waitFor({state: 'visible'});
  // Chromium logs an expected 409 resource response as console.error. Preserve it in
  // httpErrors as expected evidence, but do not treat this deliberately exercised branch
  // as an unexpected browser failure.
  for (let index = failures.length - 1; index >= 0; index -= 1) {
    if (failures[index].url.includes('/admin/settings') && failures[index].message.includes('409')) failures.splice(index, 1);
  }
  for (const item of httpErrors) {
    if (item.responseUrl.includes('/api/admin/settings') && item.status === 409) item.expected = true;
  }
  await admin.reload();
  await admin.getByLabel('单条输入字数').waitFor({state: 'visible'});
  assert.equal(await admin.getByLabel('单条输入字数').inputValue(), '4998');
  await admin.getByLabel('单条输入字数').fill('5000');
  await admin.getByRole('button', {name: '保存本页'}).click();
  await admin.getByRole('button', {name: '保存本页'}).waitFor({state: 'hidden'});
  recordOperation('/admin/settings', '保存运营设置', {precondition: 'owner + settings.write', api: 'PATCH /api/admin/settings', persistence: 'operation_settings + setting_revisions', normal: '通过', refresh: '通过', failure: '越界值与版本冲突均可见', repeated: '同步双击仅一次 PATCH', status: '通过'});

  // Compliance: persist the registration policy through the real form, reload it,
  // prove validation/concurrency rejection, then restore the original fixture.
  const complianceBeforeResponse = await admin.request.get(`${adminOrigin}/api/admin/compliance`);
  assert.equal(complianceBeforeResponse.status(), 200);
  const complianceBefore = (await complianceBeforeResponse.json()).policy;
  await admin.goto(`${adminOrigin}/admin/compliance`);
  const minimumAgeInput = admin.getByRole('spinbutton', {name: '最低年龄', exact: true});
  await minimumAgeInput.waitFor({state: 'visible'});
  await admin.getByLabel('要求注册者确认达到最低年龄').check();
  await minimumAgeInput.fill('18');
  await admin.getByLabel('年龄政策版本').fill('e2e-age-policy');
  await admin.getByLabel('服务条款版本').fill('e2e-terms');
  await admin.getByLabel('隐私政策版本').fill('e2e-privacy');
  await admin.getByLabel('变更理由').fill('E2E 合规设置持久化验收');
  const complianceWrites = [];
  const countComplianceWrite = request => { if (request.url().endsWith('/api/admin/compliance') && request.method() === 'PATCH') complianceWrites.push(request); };
  admin.on('request', countComplianceWrite);
  const complianceSave = admin.waitForResponse(response => response.url().endsWith('/api/admin/compliance') && response.request().method() === 'PATCH');
  await admin.getByRole('button', {name: '保存设置'}).evaluate(button => {button.click(); button.click();});
  assert.equal((await complianceSave).status(), 200);
  await admin.waitForTimeout(200);
  admin.off('request', countComplianceWrite);
  assert.equal(complianceWrites.length, 1);
  const complianceReload = admin.waitForResponse(response => response.url().endsWith('/api/admin/compliance') && response.request().method() === 'GET');
  await admin.reload();
  assert.equal((await complianceReload).status(), 200);
  assert.equal(await admin.getByRole('spinbutton', {name: '最低年龄', exact: true}).inputValue(), '18');
  assert.equal(await admin.getByLabel('服务条款版本').inputValue(), 'e2e-terms');
  const complianceCurrent = (await (await admin.request.get(`${adminOrigin}/api/admin/compliance`)).json()).policy;
  const invalidCompliance = await admin.request.patch(`${adminOrigin}/api/admin/compliance`, {data: {...complianceCurrent, minimumAge: 0, reason: 'E2E 非法年龄'}});
  assert.equal(invalidCompliance.status(), 400);
  const staleCompliance = await admin.request.patch(`${adminOrigin}/api/admin/compliance`, {data: {...complianceCurrent, version: complianceCurrent.version - 1, reason: 'E2E 过期版本'}});
  assert.equal(staleCompliance.status(), 409);
  const restoreCompliance = await admin.request.patch(`${adminOrigin}/api/admin/compliance`, {data: {...complianceBefore, version: complianceCurrent.version, reason: 'E2E 恢复原合规设置'}});
  assert.equal(restoreCompliance.status(), 200);
  const complianceRestoreReload = admin.waitForResponse(response => response.url().endsWith('/api/admin/compliance') && response.request().method() === 'GET');
  await admin.reload();
  assert.equal((await complianceRestoreReload).status(), 200);
  assert.equal(await admin.getByLabel('要求注册者确认达到最低年龄').isChecked(), complianceBefore.ageGateEnabled);
  recordOperation('/admin/compliance', '保存注册合规要求', {precondition: 'compliance.manage', api: 'PATCH /api/admin/compliance', persistence: 'compliance_policy + admin_audit_logs', normal: '通过并恢复原策略', refresh: '通过', failure: '非法年龄 400、过期版本 409', repeated: '同步双击仅一次 PATCH', status: '通过'});

  // Site content: create and reload a real banner draft, publish it, inspect its
  // revision, unpublish it, and prove invalid href/version failures are visible.
  await admin.goto(`${adminOrigin}/admin/site-content`);
  await admin.getByRole('button', {name: '新增草稿'}).click();
  let siteContentDialog = admin.getByRole('dialog', {name: '新增内容草稿'});
  await siteContentDialog.getByLabel('标题').fill('E2E 临时横幅');
  await siteContentDialog.getByLabel('说明').fill('仅用于隔离站点内容操作验收。');
  await siteContentDialog.getByLabel('站内跳转路径').fill('/discover');
  await siteContentDialog.getByLabel('操作理由').fill('E2E 创建临时横幅草稿');
  const siteContentCreates = [];
  const countSiteContentCreate = request => { if (request.url().endsWith('/api/admin/site-content/BANNER') && request.method() === 'POST') siteContentCreates.push(request); };
  admin.on('request', countSiteContentCreate);
  const createSiteContentResponse = admin.waitForResponse(response => response.url().endsWith('/api/admin/site-content/BANNER') && response.request().method() === 'POST');
  await siteContentDialog.getByRole('button', {name: '保存草稿'}).evaluate(button => {button.click(); button.click();});
  const createSiteContent = await createSiteContentResponse;
  assert.equal(createSiteContent.status(), 201);
  const createdSiteContent = await createSiteContent.json();
  await admin.waitForTimeout(200);
  admin.off('request', countSiteContentCreate);
  assert.equal(siteContentCreates.length, 1);
  await admin.reload();
  await admin.getByText('首页大图 · E2E 临时横幅', {exact: true}).waitFor({state: 'visible'});
  await admin.getByRole('button', {name: '编辑与预览'}).last().click();
  siteContentDialog = admin.getByRole('dialog', {name: '编辑站点内容'});
  await siteContentDialog.getByLabel('标题').waitFor({state: 'visible'});
  assert.equal(await siteContentDialog.getByLabel('标题').inputValue(), 'E2E 临时横幅');
  await siteContentDialog.getByLabel('操作理由').fill('E2E 发布临时横幅');
  const sitePublishWrites = [];
  const countSitePublish = request => { if (request.url().endsWith(`/api/admin/site-content/BANNER/${createdSiteContent.id}`) && request.method() === 'PATCH') sitePublishWrites.push(request); };
  admin.on('request', countSitePublish);
  const publishSiteContentResponse = admin.waitForResponse(response => response.url().endsWith(`/api/admin/site-content/BANNER/${createdSiteContent.id}`) && response.request().method() === 'PATCH');
  await siteContentDialog.getByRole('button', {name: '立即发布'}).evaluate(button => {button.click(); button.click();});
  assert.equal((await publishSiteContentResponse).status(), 200);
  await admin.waitForTimeout(200);
  admin.off('request', countSitePublish);
  assert.equal(sitePublishWrites.length, 1);
  await siteContentDialog.getByRole('button', {name: '查看发布历史'}).click();
  await siteContentDialog.getByText(/版本 \d+ ·/).first().waitFor({state: 'visible'});
  await siteContentDialog.getByLabel('操作理由').fill('E2E 下架临时横幅');
  const unpublishSiteContentResponse = admin.waitForResponse(response => response.url().endsWith(`/api/admin/site-content/BANNER/${createdSiteContent.id}`) && response.request().method() === 'PATCH');
  await siteContentDialog.getByRole('button', {name: '下架'}).click();
  assert.equal((await unpublishSiteContentResponse).status(), 200);
  const siteContentState = await admin.request.get(`${adminOrigin}/api/admin/site-content`);
  const siteContentRow = (await siteContentState.json()).BANNER.items.find(row => row.id === createdSiteContent.id);
  assert.equal(siteContentRow.status, 'UNPUBLISHED');
  const invalidSiteContent = await admin.request.post(`${adminOrigin}/api/admin/site-content/BANNER`, {data: {action: 'SAVE', reason: 'E2E 非法外链', content: {...siteContentRow.content, title: '非法横幅', href: 'https://example.test'}}});
  assert.equal(invalidSiteContent.status(), 400);
  const staleSiteContent = await admin.request.patch(`${adminOrigin}/api/admin/site-content/BANNER/${createdSiteContent.id}`, {data: {action: 'SAVE', reason: 'E2E 过期内容版本', version: Math.max(0, siteContentRow.version - 1), content: siteContentRow.content}});
  assert.equal(staleSiteContent.status(), 409);
  recordOperation('/admin/site-content', '横幅草稿新增/刷新/发布/历史/下架', {precondition: 'site.content.manage + site.content.publish', api: 'POST/PATCH/GET /api/admin/site-content', persistence: '站点横幅 + site_content_drafts/revisions + admin_audit_logs', normal: '通过（隔离数据库）', refresh: '通过', failure: '外部链接 400、过期版本 409', repeated: '同步双击仅一次 POST/PATCH', status: '通过'});

  // Moderation: execute reversible user restriction and an appeal decision through
  // the real queues. Both target accounts are isolated fixtures.
  await admin.goto(`${adminOrigin}/admin/moderation`);
  let reportArticle = admin.locator('article').filter({hasText: 'E2E 举报封禁与解封验收。'});
  await reportArticle.waitFor({state: 'visible'});
  await reportArticle.getByLabel('处置记录说明').fill('E2E 根据隔离举报暂时封禁');
  const moderationWrites = [];
  const countModerationWrite = request => { if (request.url().endsWith(`/api/admin/moderation/reports/${seededContent.moderationReport.id}`) && request.method() === 'PATCH') moderationWrites.push(request); };
  admin.on('request', countModerationWrite);
  const banResponse = admin.waitForResponse(response => response.url().endsWith(`/api/admin/moderation/reports/${seededContent.moderationReport.id}`) && response.request().method() === 'PATCH');
  await reportArticle.getByRole('button', {name: '封禁社区发言'}).evaluate(button => {button.click(); button.click();});
  assert.equal((await banResponse).status(), 200);
  await admin.waitForTimeout(200);
  admin.off('request', countModerationWrite);
  assert.equal(moderationWrites.length, 1);
  assert.ok((await fixture.db.user.findUniqueOrThrow({where: {id: seededContent.contentUsers[3].id}})).communityBannedAt);
  await admin.getByLabel('举报状态').selectOption('ALL');
  reportArticle = admin.locator('article').filter({hasText: 'E2E 举报封禁与解封验收。'});
  await reportArticle.waitFor({state: 'visible'});
  await reportArticle.getByLabel('处置记录说明').fill('E2E 验收后解除隔离封禁');
  const unbanResponse = admin.waitForResponse(response => response.url().endsWith(`/api/admin/moderation/reports/${seededContent.moderationReport.id}`) && response.request().method() === 'PATCH');
  await reportArticle.getByRole('button', {name: '解除封禁'}).click();
  assert.equal((await unbanResponse).status(), 200);
  assert.equal((await fixture.db.user.findUniqueOrThrow({where: {id: seededContent.contentUsers[3].id}})).communityBannedAt, null);
  const invalidModeration = await admin.request.patch(`${adminOrigin}/api/admin/moderation/reports/${seededContent.moderationReport.id}`, {data: {action: 'UNKNOWN', reason: 'E2E 非法动作'}});
  assert.equal(invalidModeration.status(), 400);

  await admin.getByRole('tab', {name: '申诉队列'}).click();
  const appealArticle = admin.locator('article').filter({hasText: 'E2E 社区封禁申诉验收。'});
  await appealArticle.waitFor({state: 'visible'});
  await appealArticle.getByLabel('复核说明').fill('E2E 接受申诉并解除隔离封禁');
  const appealWrites = [];
  const countAppealWrite = request => { if (request.url().endsWith(`/api/admin/moderation/appeals/${seededContent.moderationAppeal.id}`) && request.method() === 'PATCH') appealWrites.push(request); };
  admin.on('request', countAppealWrite);
  const appealResponse = admin.waitForResponse(response => response.url().endsWith(`/api/admin/moderation/appeals/${seededContent.moderationAppeal.id}`) && response.request().method() === 'PATCH');
  await appealArticle.getByRole('button', {name: '接受申诉并解封'}).evaluate(button => {button.click(); button.click();});
  assert.equal((await appealResponse).status(), 200);
  await admin.waitForTimeout(200);
  admin.off('request', countAppealWrite);
  assert.equal(appealWrites.length, 1);
  assert.equal((await fixture.db.communityAppeal.findUniqueOrThrow({where: {id: seededContent.moderationAppeal.id}})).status, 'ACCEPTED');
  assert.equal((await fixture.db.user.findUniqueOrThrow({where: {id: seededContent.contentUsers[4].id}})).communityBannedAt, null);
  const duplicateAppeal = await admin.request.patch(`${adminOrigin}/api/admin/moderation/appeals/${seededContent.moderationAppeal.id}`, {data: {status: 'REJECTED', resolution: 'E2E 重复处理'}});
  assert.equal(duplicateAppeal.status(), 409);
  await admin.getByRole('tab', {name: '审计记录'}).click();
  await admin.getByText(/APPEAL_REVIEWED_ACCEPTED/).waitFor({state: 'visible'});
  recordOperation('/admin/moderation', '举报封禁/解封与申诉接受', {precondition: 'moderation.write + 隔离举报/申诉', api: 'PATCH /api/admin/moderation/reports|appeals/:id', persistence: 'users + reports/community_appeals + moderation_actions', normal: '三类动作通过并恢复用户状态', refresh: '队列与审计刷新通过', failure: '非法动作 400、重复申诉 409', repeated: '同步双击各仅一次 PATCH', status: '通过'});

  // Finance packages are configuration only: no checkout, payment callback or refund
  // provider is invoked. Exercise create/edit/reload/stale-write/delete on one inactive row.
  await admin.goto(`${adminOrigin}/admin/finance?tab=packages`);
  await admin.getByRole('tab', {name: '套餐'}).click();
  await admin.getByLabel('套餐名称').fill('E2E 临时金币套餐');
  await admin.getByLabel('人民币价格（元）').fill('9.99');
  await admin.getByLabel('基础金币').fill('100');
  await admin.getByLabel('赠送金币').fill('20');
  await admin.getByLabel('权益说明（每行一条，最多 8 条）').fill('E2E 专属标识\nE2E 活动资格');
  await admin.getByLabel('排序').fill('99');
  await admin.getByLabel('上架套餐').uncheck();
  const packageCreates = [];
  const countPackageCreate = request => { if (request.url().endsWith('/api/admin/finance/packages') && request.method() === 'POST') packageCreates.push(request); };
  admin.on('request', countPackageCreate);
  const packageCreateResponse = admin.waitForResponse(response => response.url().endsWith('/api/admin/finance/packages') && response.request().method() === 'POST');
  await admin.getByRole('button', {name: '保存套餐'}).evaluate(button => {button.click(); button.click();});
  const createdPackageResponse = await packageCreateResponse;
  assert.equal(createdPackageResponse.status(), 201);
  const createdPackage = await createdPackageResponse.json();
  await admin.waitForTimeout(200);
  admin.off('request', countPackageCreate);
  assert.equal(packageCreates.length, 1);
  await admin.reload();
  await admin.getByText('E2E 临时金币套餐', {exact: true}).waitFor({state: 'visible'});
  const createdPackageRow = await fixture.db.coinPackage.findUniqueOrThrow({where: {id: createdPackage.id}});
  assert.equal(createdPackageRow.priceCnyCents, 999);
  assert.equal(createdPackageRow.benefitsJson, '["E2E 专属标识","E2E 活动资格"]');
  await admin.getByRole('button', {name: '编辑 E2E 临时金币套餐'}).click();
  await admin.getByLabel('人民币价格（元）').fill('10.99');
  await admin.getByLabel('赠送金币').fill('30');
  const packageUpdateResponse = admin.waitForResponse(response => response.url().endsWith(`/api/admin/finance/packages/${createdPackage.id}`) && response.request().method() === 'PUT');
  await admin.getByRole('button', {name: '保存套餐'}).click();
  assert.equal((await packageUpdateResponse).status(), 200);
  const updatedPackage = await fixture.db.coinPackage.findUniqueOrThrow({where: {id: createdPackage.id}});
  assert.equal(updatedPackage.priceCnyCents, 1099);
  assert.equal(updatedPackage.bonus, 30);
  const invalidPackage = await admin.request.post(`${adminOrigin}/api/admin/finance/packages`, {data: {label: 'E2E 非法套餐', coins: 1, bonus: 0, priceCnyCents: 0, sortOrder: 0, isActive: false, bonusStartsAt: null, bonusEndsAt: null}});
  assert.equal(invalidPackage.status(), 400);
  const stalePackage = await admin.request.put(`${adminOrigin}/api/admin/finance/packages/${createdPackage.id}`, {data: {label: updatedPackage.label, coins: updatedPackage.coins, bonus: updatedPackage.bonus, priceCnyCents: updatedPackage.priceCnyCents, sortOrder: updatedPackage.sortOrder, isActive: false, bonusStartsAt: null, bonusEndsAt: null, version: createdPackage.version}});
  assert.equal(stalePackage.status(), 409);
  await admin.reload();
  const packageRow = admin.getByText('E2E 临时金币套餐', {exact: true}).locator('xpath=ancestor::tr');
  await packageRow.getByRole('button', {name: '删除'}).click();
  const deletePackageDialog = admin.getByRole('dialog', {name: '删除已下架套餐'});
  await deletePackageDialog.getByLabel('删除理由').fill('E2E 套餐配置验收完成后清理');
  const packageDeletes = [];
  const countPackageDelete = request => { if (request.url().endsWith(`/api/admin/finance/packages/${createdPackage.id}`) && request.method() === 'DELETE') packageDeletes.push(request); };
  admin.on('request', countPackageDelete);
  const packageDeleteResponse = admin.waitForResponse(response => response.url().endsWith(`/api/admin/finance/packages/${createdPackage.id}`) && response.request().method() === 'DELETE');
  await deletePackageDialog.getByRole('button', {name: '确认删除'}).evaluate(button => {button.click(); button.click();});
  assert.equal((await packageDeleteResponse).status(), 200);
  await admin.waitForTimeout(200);
  admin.off('request', countPackageDelete);
  assert.equal(packageDeletes.length, 1);
  assert.equal(await fixture.db.coinPackage.findUnique({where: {id: createdPackage.id}}), null);
  recordOperation('/admin/finance', '金币套餐新增/权益/刷新/编辑/下架删除', {precondition: 'finance.packages.write；不触发支付', api: 'POST/PUT/DELETE /api/admin/finance/packages', persistence: 'coin_packages（含权益） + coin_package_changes + admin_audit_logs', normal: '通过并清理', refresh: '权益与价格刷新持久化通过', failure: '零价格 400、过期版本 409', repeated: '同步双击新增/删除各仅一次请求', status: '通过'});

  // Accounts: edit profile, reload persistence, community ban/unban, suspend/restore,
  // session revocation, stale-version rejection, and synchronous duplicate protection.
  const managedAccount = seededContent.contentUsers[5];
  await admin.goto(`${adminOrigin}/admin/accounts`);
  await admin.getByLabel('搜索用户').fill(managedAccount.email);
  await admin.getByRole('button', {name: '搜索用户'}).click();
  await admin.getByRole('button', {name: `查看用户 ${managedAccount.username}`}).click();
  let managedDetail = admin.getByRole('dialog', {name: /用户详情/});
  await managedDetail.waitFor({state: 'visible'});
  await managedDetail.getByRole('tab', {name: '基本资料'}).click();
  await managedDetail.getByLabel('昵称').last().fill('内容用户 6 · 已验收');
  await managedDetail.getByPlaceholder('说明为什么需要修改资料').fill('E2E 验证资料持久化');
  const profileWrites = [];
  const countProfileWrite = request => {
    if (request.url().includes(`/api/admin/accounts/${managedAccount.id}/profile`) && request.method() === 'PATCH') profileWrites.push(request);
  };
  admin.on('request', countProfileWrite);
  const profileResponse = admin.waitForResponse(response => response.url().includes(`/api/admin/accounts/${managedAccount.id}/profile`) && response.request().method() === 'PATCH');
  await managedDetail.getByRole('button', {name: '保存公开资料'}).evaluate(button => {button.click(); button.click();});
  assert.equal((await profileResponse).status(), 200);
  await managedDetail.getByRole('status').filter({hasText: /用户资料已保存/}).waitFor({state: 'visible'});
  await admin.waitForTimeout(250);
  admin.off('request', countProfileWrite);
  assert.equal(profileWrites.length, 1, 'duplicate profile click must produce one PATCH');
  assert.equal((await fixture.db.user.findUnique({where: {id: managedAccount.id}, select: {displayName: true}}))?.displayName, '内容用户 6 · 已验收');

  async function runAccountAction(action, reason, {confirm = false, expectedText} = {}) {
    const dialog = admin.getByRole('dialog', {name: /用户详情/});
    await dialog.getByLabel('操作类型').selectOption(action);
    await dialog.getByLabel('操作理由').last().fill(reason);
    const response = admin.waitForResponse(item => item.url().endsWith(`/api/admin/accounts/${managedAccount.id}`) && item.request().method() === 'PATCH');
    await dialog.getByRole('button', {name: '执行账号操作'}).click();
    if (confirm) await admin.getByRole('dialog', {name: '确认账号操作'}).getByRole('button', {name: '确认执行'}).click();
    assert.equal((await response).status(), 200);
    if (expectedText) await dialog.getByText(expectedText, {exact: true}).waitFor({state: 'visible'});
    await admin.waitForTimeout(250);
  }
  await runAccountAction('BAN_COMMUNITY', 'E2E 验证社区禁言', {expectedText: '社区禁言中'});
  await runAccountAction('UNBAN_COMMUNITY', 'E2E 验证解除禁言');
  await runAccountAction('SUSPEND', 'E2E 验证停用', {confirm: true});
  await runAccountAction('RESTORE', 'E2E 验证恢复');
  await runAccountAction('REVOKE_SESSIONS', 'E2E 验证撤销会话', {confirm: true});
  const staleAccountWrite = await admin.request.patch(`${adminOrigin}/api/admin/accounts/${managedAccount.id}`, {data: {action: 'BAN_COMMUNITY', reason: 'E2E 过期版本必须失败', version: 0}});
  assert.equal(staleAccountWrite.status(), 409);
  const finalManagedAccount = await fixture.db.user.findUnique({where: {id: managedAccount.id}, select: {displayName: true, suspendedAt: true, communityBannedAt: true, tokenVersion: true, accountVersion: true}});
  assert.equal(finalManagedAccount?.displayName, '内容用户 6 · 已验收');
  assert.equal(finalManagedAccount?.suspendedAt, null);
  assert.equal(finalManagedAccount?.communityBannedAt, null);
  assert.ok((finalManagedAccount?.tokenVersion ?? 0) > 0);
  await managedDetail.getByRole('button', {name: '关闭详情'}).click();
  await managedDetail.waitFor({state: 'hidden'});
  recordOperation('/admin/accounts', '修改公开资料', {precondition: 'accounts.manage', api: 'PATCH /api/admin/accounts/:id/profile', persistence: 'users + admin_account_actions', normal: '通过', refresh: 'DB 与重新读取通过', failure: '过期版本 409', repeated: '同步双击仅一次 PATCH', status: '通过'});
  recordOperation('/admin/accounts', '停用/恢复/禁言/解禁/撤销会话', {precondition: '对应 accounts 权限', api: 'PATCH /api/admin/accounts/:id', persistence: 'users 状态、tokenVersion、审计', normal: '五类动作通过并恢复夹具', refresh: '通过', failure: '过期版本 409', repeated: '服务端版本锁保护', status: '通过'});

  // AI configuration CRUD uses inactive, secret-free records and never calls a provider.
  await admin.goto(`${adminOrigin}/admin/ai/providers`);
  await admin.getByRole('button', {name: '新增供应商'}).click();
  let providerDialog = admin.getByRole('dialog', {name: '新增供应商'});
  await providerDialog.getByLabel('供应商名称').fill('E2E 隔离供应商');
  await providerDialog.getByLabel('API 基础地址').fill('https://example.com/v1');
  await providerDialog.getByLabel('操作理由').fill('E2E 验证供应商 CRUD');
  const providerWrites = [];
  const countProviderWrite = request => {
    if (request.url().endsWith('/api/admin/ai/providers') && request.method() === 'POST') providerWrites.push(request);
  };
  admin.on('request', countProviderWrite);
  const providerCreate = admin.waitForResponse(response => response.url().endsWith('/api/admin/ai/providers') && response.request().method() === 'POST');
  await providerDialog.getByRole('button', {name: '保存供应商'}).evaluate(button => {button.click(); button.click();});
  assert.equal((await providerCreate).status(), 201);
  await admin.getByRole('button', {name: '编辑 E2E 隔离供应商'}).waitFor({state: 'visible'});
  await admin.waitForTimeout(200);
  admin.off('request', countProviderWrite);
  assert.equal(providerWrites.length, 1);
  await admin.reload();
  await admin.getByRole('button', {name: '编辑 E2E 隔离供应商'}).waitFor({state: 'visible'});
  const invalidProvider = await admin.request.post(`${adminOrigin}/api/admin/ai/providers`, {data: {name: 'E2E 非法供应商', baseUrl: 'http://127.0.0.1:9/v1', protocol: 'OPENAI_COMPATIBLE', isActive: false, sortOrder: 0, reason: 'E2E SSRF 拒绝'}});
  assert.equal(invalidProvider.status(), 400);
  const savedProvider = await fixture.db.aiProvider.findFirst({where: {name: 'E2E 隔离供应商'}});
  assert.ok(savedProvider);

  await admin.goto(`${adminOrigin}/admin/ai/models`);
  await admin.getByRole('button', {name: '新增模型'}).click();
  let modelDialog = admin.getByRole('dialog', {name: '新增模型路由'});
  await modelDialog.getByLabel('逻辑模型标识').fill('e2e-isolated-model');
  await modelDialog.getByLabel('前台显示名称').fill('E2E 隔离模型');
  await modelDialog.getByLabel('供应商选择').selectOption(savedProvider.id);
  await modelDialog.getByLabel('供应商模型代码').fill('never-called');
  await modelDialog.getByLabel('操作理由').fill('E2E 验证模型 CRUD');
  const modelCreate = admin.waitForResponse(response => response.url().endsWith('/api/admin/ai/models') && response.request().method() === 'POST');
  await modelDialog.getByRole('button', {name: '保存路由'}).click();
  assert.equal((await modelCreate).status(), 201);
  await admin.getByRole('button', {name: '编辑 E2E 隔离模型'}).waitFor({state: 'visible'});
  await admin.reload();
  await admin.getByRole('button', {name: '编辑 E2E 隔离模型'}).waitFor({state: 'visible'});
  const savedModel=await fixture.db.aiModel.findUniqueOrThrow({where:{key:'e2e-isolated-model'}});

  // Cost tiers are append-only provider cost versions, independent from the
  // per-reply coin price. Use the real drawer and verify its persisted ranges.
  await admin.goto(`${adminOrigin}/admin/ai/costs`);
  await admin.getByLabel('编辑价格 E2E 隔离模型').click();
  const priceDrawer=admin.getByRole('dialog',{name:'编辑价格 · E2E 隔离模型'});
  await priceDrawer.getByLabel('每条回复币价').fill('2');
  await priceDrawer.getByLabel('输入单价').fill('1');
  await priceDrawer.getByLabel('输出单价').fill('2');
  const effectiveNow=await admin.evaluate(()=>{const date=new Date(Date.now()-60_000),pad=value=>String(value).padStart(2,'0');return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;});
  await priceDrawer.getByLabel('生效时间').fill(effectiveNow);
  await priceDrawer.getByLabel('价格来源').fill('E2E 隔离合同样本');
  await priceDrawer.getByLabel('操作理由').fill('E2E 验证成本阶梯');
  await priceDrawer.getByRole('button',{name:'添加阶梯'}).click();
  await priceDrawer.getByLabel('阶梯 1 结束 Token').fill('100');
  await priceDrawer.getByLabel('阶梯 1 缓存输入单价').fill('0.5');
  await priceDrawer.getByRole('button',{name:'添加阶梯'}).click();
  await priceDrawer.getByLabel('阶梯 2 输入单价').fill('3');
  await priceDrawer.getByLabel('阶梯 2 输出单价').fill('4');
  const tierPriceSave=admin.waitForResponse(response=>response.url().endsWith('/api/admin/ai/prices')&&response.request().method()==='POST');
  await priceDrawer.getByRole('button',{name:'保存价格'}).click();
  assert.equal((await tierPriceSave).status(),201);
  const tierPrice=await fixture.db.aiModelPrice.findFirstOrThrow({where:{modelId:savedModel.id},include:{tiers:{orderBy:{sortOrder:'asc'}}}});
  assert.deepEqual(tierPrice.tiers.map(row=>[row.minInputTokens,row.maxInputTokens]),[[0,100],[100,null]]);
  await admin.reload();await admin.getByLabel('编辑价格 E2E 隔离模型').click();
  await admin.getByText('2 档（按输入 Token 区间）',{exact:true}).waitFor({state:'visible'});
  const invalidTierPrice=await admin.request.post(`${adminOrigin}/api/admin/ai/prices`,{data:{modelId:savedModel.id,currency:'USD',inputPricePerMillion:'1',outputPricePerMillion:'2',effectiveAt:new Date(Date.now()+60_000).toISOString(),source:'E2E invalid tier',reason:'E2E 验证阶梯断档',tiers:[{minInputTokens:0,maxInputTokens:90,inputPricePerMillion:'1',outputPricePerMillion:'2',cachedInputPricePerMillion:null},{minInputTokens:100,maxInputTokens:null,inputPricePerMillion:'3',outputPricePerMillion:'4',cachedInputPricePerMillion:null}]}});
  assert.equal(invalidTierPrice.status(),400);
  recordOperation('/admin/ai/costs','供应商成本阶梯新增/刷新/边界校验',{precondition:'ai.costs.manage + billing.manage + 隔离模型',api:'POST/GET /api/admin/ai/prices',persistence:'ai_model_prices/ai_model_price_tiers + admin_audit_logs',normal:'两档成本价通过',refresh:'通过',failure:'区间断档 400',repeated:'追加版本唯一键保护',status:'通过'});
  // Prices are append-only in product usage. This isolated cleanup only removes
  // the temporary model dependencies so the existing model delete case can run.
  await fixture.db.modelCoinPrice.deleteMany({where:{modelId:savedModel.id}});
  await fixture.db.aiModelPrice.deleteMany({where:{modelId:savedModel.id}});
  await admin.goto(`${adminOrigin}/admin/ai/models`);
  await admin.getByRole('button', {name: '删除 / 查看原因'}).click();
  const deleteModelDialog = admin.getByRole('dialog', {name: '删除 AI 模型'});
  await deleteModelDialog.getByLabel('删除理由').fill('E2E 清理无引用模型');
  const modelDelete = admin.waitForResponse(response => response.url().includes('/api/admin/ai/models/') && response.request().method() === 'DELETE');
  await deleteModelDialog.getByRole('button', {name: '确认删除'}).click();
  assert.equal((await modelDelete).status(), 200);
  assert.equal(await fixture.db.aiModel.count({where: {key: 'e2e-isolated-model'}}), 0);

  await admin.goto(`${adminOrigin}/admin/ai/providers`);
  await admin.getByRole('button', {name: '删除 / 查看原因'}).click();
  const deleteProviderDialog = admin.getByRole('dialog', {name: '删除 AI 供应商'});
  await deleteProviderDialog.getByLabel('删除理由').fill('E2E 清理无引用供应商');
  const providerDelete = admin.waitForResponse(response => response.url().includes('/api/admin/ai/providers/') && response.request().method() === 'DELETE');
  await deleteProviderDialog.getByRole('button', {name: '确认删除'}).click();
  assert.equal((await providerDelete).status(), 200);
  assert.equal(await fixture.db.aiProvider.count({where: {name: 'E2E 隔离供应商'}}), 0);
  recordOperation('/admin/ai/providers', '供应商新增/刷新/删除', {precondition: 'ai.providers.manage；保持停用且无密钥', api: 'POST/GET/DELETE /api/admin/ai/providers', persistence: 'ai_providers + admin_audit_logs', normal: '通过并清理', refresh: '通过', failure: '私网 HTTP 地址 400', repeated: '同步双击仅一次 POST', status: '通过'});
  recordOperation('/admin/ai/models', '模型新增/刷新/删除', {precondition: 'ai.models.manage + 已有供应商', api: 'POST/GET/DELETE /api/admin/ai/models', persistence: 'ai_models + admin_audit_logs', normal: '通过并清理', refresh: '通过', failure: '删除守卫集成测试通过', repeated: '服务端唯一键/版本锁', status: '通过'});
  recordOperation('/admin/ai/providers', '测试供应商连接', {precondition: '需真实密钥和外部网络', api: 'POST /api/admin/ai/providers/:id/test', persistence: 'lastCheck*', normal: '未执行', refresh: '未执行', failure: '无密钥时 UI 不展示按钮', repeated: '未执行', status: '需外部授权阻塞', blocker: '本轮禁止外部调用和付费服务'});

  // Growth modules: create inactive mission/gift records, prove refresh persistence,
  // exercise invalid input/duplicate protection, then delete the isolated records.
  await admin.goto(`${adminOrigin}/admin/growth`);
  await admin.getByRole('tab', {name: '玩法模块'}).click();
  await admin.getByLabel('玩法模块变更理由').fill('E2E 验证玩法模块停用');
  let checkinModule=admin.locator('[data-growth-module="checkin"]');
  const moduleWrites=[];
  const countModuleWrite=request=>{if(request.url().endsWith('/api/admin/growth/modules')&&request.method()==='PUT')moduleWrites.push(request);};
  admin.on('request',countModuleWrite);
  const disableModule=admin.waitForResponse(response=>response.url().endsWith('/api/admin/growth/modules')&&response.request().method()==='PUT');
  await checkinModule.getByRole('button',{name:'停用'}).evaluate(button=>{button.click();button.click();});
  assert.equal((await disableModule).status(),200);
  await admin.waitForTimeout(200);admin.off('request',countModuleWrite);
  assert.equal(moduleWrites.length,1,'a synchronous duplicate module click must produce one PUT');
  assert.equal((await fixture.db.growthModuleState.findUniqueOrThrow({where:{moduleId:'checkin'}})).isEnabled,false);
  await admin.reload();await admin.getByRole('tab',{name:'玩法模块'}).click();
  checkinModule=admin.locator('[data-growth-module="checkin"]');
  await checkinModule.getByText('已停用',{exact:true}).waitFor({state:'visible'});
  const staleModule=await admin.request.put(`${adminOrigin}/api/admin/growth/modules`,{data:{moduleId:'checkin',isEnabled:true,config:{},version:0,reason:'E2E 过期玩法版本'}});
  assert.equal(staleModule.status(),409);
  await admin.getByLabel('玩法模块变更理由').fill('E2E 恢复玩法模块');
  const enableModule=admin.waitForResponse(response=>response.url().endsWith('/api/admin/growth/modules')&&response.request().method()==='PUT');
  await checkinModule.getByRole('button',{name:'启用'}).click();
  assert.equal((await enableModule).status(),200);
  assert.equal((await fixture.db.growthModuleState.findUniqueOrThrow({where:{moduleId:'checkin'}})).isEnabled,true);
  recordOperation('/admin/growth','玩法模块启停/刷新/版本保护',{precondition:'growth.manage + 静态注册模块',api:'GET/PUT /api/admin/growth/modules',persistence:'growth_module_states + admin_audit_logs',normal:'停用并恢复通过，历史未删除',refresh:'通过',failure:'过期版本 409',repeated:'同步双击仅一次 PUT',status:'通过'});
  await admin.getByRole('tab', {name: '任务配置'}).click();
  await admin.getByRole('button', {name: '新建任务'}).click();
  const missionDialog = admin.getByRole('dialog', {name: '新建任务'});
  await missionDialog.getByLabel('任务名称').fill('E2E 隔离任务');
  await missionDialog.getByLabel('金币奖励').fill('1');
  await missionDialog.getByLabel('操作理由').fill('E2E 验证任务 CRUD');
  const missionWrites = [];
  const countMissionWrite = request => {
    if (request.url().endsWith('/api/admin/growth/missions') && request.method() === 'POST') missionWrites.push(request);
  };
  admin.on('request', countMissionWrite);
  const missionCreate = admin.waitForResponse(response => response.url().endsWith('/api/admin/growth/missions') && response.request().method() === 'POST');
  await missionDialog.getByRole('button', {name: '保存任务'}).evaluate(button => {button.click(); button.click();});
  assert.equal((await missionCreate).status(), 201);
  await admin.getByRole('heading', {name: 'E2E 隔离任务'}).waitFor({state: 'visible'});
  await admin.waitForTimeout(200);
  admin.off('request', countMissionWrite);
  assert.equal(missionWrites.length, 1);
  await admin.reload();
  const missionCard = admin.locator('article').filter({has: admin.getByRole('heading', {name: 'E2E 隔离任务'})});
  await missionCard.waitFor({state: 'visible'});
  const invalidMission = await admin.request.post(`${adminOrigin}/api/admin/growth/missions`, {data: {title: 'E2E 非法任务', description: '', rewardCoins: 1, category: 'DAILY', conditionType: 'MANUAL', conditionTarget: 1, period: 'DAILY', isActive: true, sortOrder: 0, startsAt: null, endsAt: null, reason: 'E2E 应拒绝手动自动发奖'}});
  assert.ok(invalidMission.status() >= 400);
  await missionCard.getByRole('button', {name: '删除'}).click();
  const deleteMissionDialog = admin.getByRole('dialog', {name: '删除已停用任务'});
  await deleteMissionDialog.getByLabel('删除理由').fill('E2E 清理隔离任务');
  const missionDelete = admin.waitForResponse(response => response.url().includes('/api/admin/growth/missions/') && response.request().method() === 'DELETE');
  await deleteMissionDialog.getByRole('button', {name: '确认删除'}).click();
  assert.equal((await missionDelete).status(), 200);
  assert.equal(await fixture.db.mission.count({where: {title: 'E2E 隔离任务'}}), 0);

  await admin.getByRole('tab', {name: '礼物目录'}).click();
  const giftPanel = admin.getByRole('region', {name: '礼物目录'});
  await giftPanel.getByLabel('礼物代码').fill('e2e-gift');
  await giftPanel.getByLabel('名称').fill('E2E 隔离礼物');
  await giftPanel.getByLabel('金币价格').fill('7');
  await giftPanel.getByLabel('启用礼物').uncheck();
  await giftPanel.getByLabel('操作理由').fill('E2E 验证礼物 CRUD');
  const giftWrites = [];
  const countGiftWrite = request => {
    if (request.url().endsWith('/api/admin/growth/gifts') && request.method() === 'POST') giftWrites.push(request);
  };
  admin.on('request', countGiftWrite);
  const giftCreate = admin.waitForResponse(response => response.url().endsWith('/api/admin/growth/gifts') && response.request().method() === 'POST');
  await giftPanel.getByRole('button', {name: '新增礼物'}).evaluate(button => {button.click(); button.click();});
  assert.equal((await giftCreate).status(), 201);
  await giftPanel.getByRole('row').filter({hasText: 'E2E 隔离礼物'}).waitFor({state: 'visible'});
  await admin.waitForTimeout(200);
  admin.off('request', countGiftWrite);
  assert.equal(giftWrites.length, 1);
  await admin.reload();
  await admin.getByRole('tab', {name: '礼物目录'}).click();
  const refreshedGiftPanel = admin.getByRole('region', {name: '礼物目录'});
  const giftRow = refreshedGiftPanel.getByRole('row').filter({hasText: 'E2E 隔离礼物'});
  await giftRow.waitFor({state: 'visible'});
  const duplicateGift = await admin.request.post(`${adminOrigin}/api/admin/growth/gifts`, {data: {code: 'e2e-gift', name: '重复礼物', description: '', emoji: '🎁', coinPrice: 7, isActive: false, sortOrder: 0, reason: 'E2E 重复代码应失败'}});
  assert.ok(duplicateGift.status() >= 400);
  await giftRow.getByRole('button', {name: '删除'}).click();
  const deleteGiftDialog = admin.getByRole('dialog', {name: '删除已停用礼物'});
  await deleteGiftDialog.getByLabel('删除理由').fill('E2E 清理隔离礼物');
  const giftDelete = admin.waitForResponse(response => response.url().includes('/api/admin/growth/gifts/') && response.request().method() === 'DELETE');
  await deleteGiftDialog.getByRole('button', {name: '确认删除'}).click();
  assert.equal((await giftDelete).status(), 200);
  assert.equal(await fixture.db.giftCatalogItem.count({where: {code: 'e2e-gift'}}), 0);
  recordOperation('/admin/growth', '任务新增/刷新/删除', {precondition: 'growth.manage', api: 'POST/GET/DELETE /api/admin/growth/missions', persistence: 'missions + admin_audit_logs', normal: '通过并清理', refresh: '通过', failure: 'MANUAL 启用发奖被拒绝', repeated: '同步双击仅一次 POST', status: '通过'});
  recordOperation('/admin/growth', '礼物新增/刷新/删除', {precondition: 'growth.manage', api: 'POST/GET/DELETE /api/admin/growth/gifts', persistence: 'gift_catalog + admin_audit_logs', normal: '通过并清理', refresh: '通过', failure: '重复代码被拒绝', repeated: '同步双击仅一次 POST', status: '通过'});

  // Community moderation: exercise every reversible post action and comment hide/restore.
  await admin.goto(`${adminOrigin}/admin/community/posts`);
  await admin.getByPlaceholder('内容、作者、圈子或帖子编号').fill(seededContent.post.content);
  await admin.getByRole('button', {name: '搜索', exact: true}).click();
  async function runPostAction(label, {double = false} = {}) {
    await admin.getByRole('button', {name: label, exact: true}).first().click();
    const dialog = admin.getByRole('dialog', {name: `确认${label}`});
    await dialog.getByLabel('操作理由').fill(`E2E 验证帖子${label}`);
    const writes = [];
    const countWrite = request => {
      if (request.url().includes(`/api/admin/community/posts/${seededContent.post.id}`) && request.method() === 'PATCH') writes.push(request);
    };
    admin.on('request', countWrite);
    const response = admin.waitForResponse(item => item.url().includes(`/api/admin/community/posts/${seededContent.post.id}`) && item.request().method() === 'PATCH');
    const confirm = dialog.getByRole('button', {name: '确认处置'});
    if (double) await confirm.evaluate(button => {button.click(); button.click();});
    else await confirm.click();
    assert.equal((await response).status(), 200);
    await admin.getByText('处置已记录，列表正在刷新。', {exact: true}).waitFor({state: 'visible'});
    await admin.waitForTimeout(250);
    admin.off('request', countWrite);
    if (double) assert.equal(writes.length, 1);
  }
  await runPostAction('置顶', {double: true});
  await runPostAction('取消置顶');
  await runPostAction('推荐');
  await runPostAction('取消推荐');
  await runPostAction('下架');
  await runPostAction('恢复');
  const postAfterActions = await fixture.db.post.findUnique({where: {id: seededContent.post.id}, select: {status: true, isPinned: true, isFeatured: true}});
  assert.deepEqual(postAfterActions, {status: 'VISIBLE', isPinned: false, isFeatured: false});
  const stalePostWrite = await admin.request.patch(`${adminOrigin}/api/admin/community/posts/${seededContent.post.id}`, {data: {action: 'PIN', reason: 'E2E 过期内容版本', updatedAt: '2000-01-01T00:00:00.000Z'}});
  assert.equal(stalePostWrite.status(), 409);

  await admin.goto(`${adminOrigin}/admin/community/comments`);
  await admin.getByPlaceholder('评论、作者、帖子编号或圈子').fill(seededContent.comment.content);
  await admin.getByRole('button', {name: '搜索', exact: true}).click();
  async function runCommentAction(label) {
    await admin.getByRole('button', {name: label, exact: true}).first().click();
    const dialog = admin.getByRole('dialog', {name: `确认${label}`});
    await dialog.getByLabel('操作理由').fill(`E2E 验证评论${label}`);
    const response = admin.waitForResponse(item => item.url().includes(`/api/admin/community/comments/${seededContent.comment.id}`) && item.request().method() === 'PATCH');
    await dialog.getByRole('button', {name: '确认处置'}).click();
    assert.equal((await response).status(), 200);
    await admin.getByText('评论处置已记录，列表正在刷新。', {exact: true}).waitFor({state: 'visible'});
    await admin.waitForTimeout(250);
  }
  await runCommentAction('下架');
  await runCommentAction('恢复');
  assert.equal((await fixture.db.postComment.findUnique({where: {id: seededContent.comment.id}, select: {status: true}}))?.status, 'VISIBLE');
  const staleCommentWrite = await admin.request.patch(`${adminOrigin}/api/admin/community/comments/${seededContent.comment.id}`, {data: {action: 'HIDE', reason: 'E2E 过期评论版本', updatedAt: '2000-01-01T00:00:00.000Z'}});
  assert.equal(staleCommentWrite.status(), 409);
  recordOperation('/admin/community/posts', '帖子下架/恢复/置顶/取消置顶/推荐/取消推荐', {precondition: 'community.write', api: 'PATCH /api/admin/community/posts/:id', persistence: 'posts + admin_audit_logs', normal: '六类可逆动作通过并恢复夹具', refresh: '每次动作后列表刷新通过', failure: '过期 updatedAt 409', repeated: '同步双击仅一次 PATCH', status: '通过'});
  recordOperation('/admin/community/comments', '评论下架/恢复', {precondition: 'community.write', api: 'PATCH /api/admin/community/comments/:id', persistence: 'post_comments + admin_audit_logs', normal: '通过并恢复夹具', refresh: '通过', failure: '过期 updatedAt 409', repeated: '服务端版本锁', status: '通过'});
  recordOperation('/admin/community/posts', '清除帖子内容', {precondition: 'community.write', api: 'PATCH ... action DELETE', persistence: '不可逆清空正文/附件 + 审计', normal: '未执行', refresh: '未执行', failure: '版本锁已验证', repeated: '未执行', status: '明确受限', blocker: '属于不可恢复内容删除，本轮仅允许隔离可逆动作'});
  recordOperation('/admin/community/comments', '清除评论内容', {precondition: 'community.write', api: 'PATCH ... action DELETE', persistence: '不可逆清空正文/附件 + 审计', normal: '未执行', refresh: '未执行', failure: '版本锁已验证', repeated: '未执行', status: '明确受限', blocker: '属于不可恢复内容删除，本轮仅允许隔离可逆动作'});

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

  // Characters: create an isolated site-owned draft through the real editor, prove
  // duplicate suppression and reload persistence, exercise a rejected payload, then
  // use the guarded UI deletion path to leave no fixture behind.
  await admin.setViewportSize({width: 1440, height: 1000});
  await admin.goto(`${adminOrigin}/admin/characters`);
  await admin.getByRole('button', {name: '新增角色'}).click();
  let characterDialog = admin.getByRole('dialog', {name: '新增角色'});
  await characterDialog.getByLabel('角色名称').fill('E2E 临时站点角色');
  await characterDialog.getByLabel('人设').fill('仅用于隔离后台操作验收。');
  await characterDialog.getByLabel('版权声明').fill('E2E 测试数据，无外部版权内容。');
  await characterDialog.getByLabel('操作理由').fill('E2E 创建后删除的临时草稿');
  const characterCreates = [];
  const countCharacterCreate = request => { if (request.url().endsWith('/api/admin/characters') && request.method() === 'POST') characterCreates.push(request); };
  admin.on('request', countCharacterCreate);
  const createCharacterResponse = admin.waitForResponse(response => response.url().endsWith('/api/admin/characters') && response.request().method() === 'POST');
  await characterDialog.getByRole('button', {name: '保存角色内容'}).evaluate(button => {button.click(); button.click();});
  assert.equal((await createCharacterResponse).status(), 201);
  await admin.getByText('角色内容已保存，公开状态由发布流程管理。', {exact: true}).first().waitFor({state: 'visible'});
  await admin.waitForTimeout(200);
  admin.off('request', countCharacterCreate);
  assert.equal(characterCreates.length, 1, 'character synchronous double click must create one draft');
  const createdCharacter = await fixture.db.character.findFirstOrThrow({where: {name: 'E2E 临时站点角色', creatorId: null}});
  await admin.reload();
  await admin.getByPlaceholder('名称、简介或角色编号').fill(createdCharacter.id);
  await admin.getByRole('button', {name: '搜索角色'}).click();
  await admin.getByRole('button', {name: '查看角色 E2E 临时站点角色'}).click();
  characterDialog = admin.getByRole('dialog', {name: /角色详情/});
  await characterDialog.getByLabel('角色名称').waitFor({state: 'visible'});
  assert.equal(await characterDialog.getByLabel('角色名称').inputValue(), 'E2E 临时站点角色');
  const invalidCharacter = await admin.request.post(`${adminOrigin}/api/admin/characters`, {data: {reason: 'E2E 非法字段', content: {name: '非法角色', personality: '非法字段测试', rogue: true}}});
  assert.equal(invalidCharacter.status(), 400);
  await characterDialog.getByRole('button', {name: '删除草稿 / 查看原因'}).click();
  const deleteCharacterDialog = admin.getByRole('dialog', {name: '删除角色草稿'});
  await deleteCharacterDialog.getByLabel('删除理由').fill('E2E 操作完成后清理临时草稿');
  const deleteCharacterResponse = admin.waitForResponse(response => response.url().endsWith(`/api/admin/characters/${createdCharacter.id}`) && response.request().method() === 'DELETE');
  await deleteCharacterDialog.getByRole('button', {name: '确认删除'}).click();
  assert.equal((await deleteCharacterResponse).status(), 200);
  await deleteCharacterDialog.waitFor({state: 'hidden'});
  assert.equal(await fixture.db.character.findUnique({where: {id: createdCharacter.id}}), null);
  recordOperation('/admin/characters', '站点角色草稿新增/刷新/删除', {precondition: 'characters.write', api: 'POST/GET/DELETE /api/admin/characters', persistence: 'characters + 素材关系 + admin_audit_logs', normal: '通过并清理', refresh: '通过', failure: '不支持字段 400', repeated: '同步双击仅一次 POST', status: '通过'});

  // Circles: create hidden, reject featuring while hidden, then restore, feature,
  // unfeature and hide again. The isolated row is removed directly after UI coverage
  // because the product intentionally has no circle deletion operation.
  await admin.goto(`${adminOrigin}/admin/circles`);
  await admin.getByRole('button', {name: '新增站点圈子'}).click();
  let circleDialog = admin.getByRole('dialog', {name: '新增站点圈子'});
  await circleDialog.getByLabel('管理圈子名称').fill('E2E 临时站点圈子');
  await circleDialog.getByLabel('管理圈子介绍').fill('仅用于隔离后台完整操作验收。');
  await circleDialog.getByLabel('管理圈子标签').fill('e2e,temporary');
  await circleDialog.getByLabel('圈子操作理由').fill('E2E 创建临时圈子');
  const circleCreates = [];
  const countCircleCreate = request => { if (request.url().endsWith('/api/admin/circles') && request.method() === 'POST') circleCreates.push(request); };
  admin.on('request', countCircleCreate);
  const createCircleResponse = admin.waitForResponse(response => response.url().endsWith('/api/admin/circles') && response.request().method() === 'POST');
  await circleDialog.getByRole('button', {name: '创建站点圈子'}).evaluate(button => {button.click(); button.click();});
  assert.equal((await createCircleResponse).status(), 201);
  await admin.getByText('圈子操作已完成。', {exact: true}).first().waitFor({state: 'visible'});
  await admin.waitForTimeout(200);
  admin.off('request', countCircleCreate);
  assert.equal(circleCreates.length, 1, 'circle synchronous double click must create one row');
  let createdCircle = await fixture.db.circle.findFirstOrThrow({where: {name: 'E2E 临时站点圈子', ownerId: null}});
  assert.equal(createdCircle.status, 'HIDDEN');
  const invalidFeature = await admin.request.patch(`${adminOrigin}/api/admin/circles/${createdCircle.id}`, {data: {action: 'FEATURE', reason: 'E2E 隐藏圈子不可推荐', updatedAt: createdCircle.updatedAt.toISOString()}});
  assert.equal(invalidFeature.status(), 409);
  await admin.reload();
  await admin.getByLabel('搜索管理圈子').fill(createdCircle.id);
  await admin.getByRole('button', {name: '搜索圈子'}).click();
  await admin.getByRole('button', {name: '查看圈子 E2E 临时站点圈子'}).click();
  circleDialog = admin.getByRole('dialog', {name: /圈子详情/});
  await circleDialog.getByLabel('管理圈子名称').waitFor({state: 'visible'});
  for (const [reason, action, expected] of [
    ['E2E 恢复公开', '恢复公开', {status: 'ACTIVE', isFeatured: false}],
    ['E2E 推荐圈子', '推荐圈子', {status: 'ACTIVE', isFeatured: true}],
    ['E2E 取消推荐', '取消推荐', {status: 'ACTIVE', isFeatured: false}],
    ['E2E 恢复隐藏', '隐藏圈子', {status: 'HIDDEN', isFeatured: false}],
  ]) {
    await circleDialog.getByLabel('圈子操作理由').fill(reason);
    const circleActionResponse = admin.waitForResponse(response => response.url().endsWith(`/api/admin/circles/${createdCircle.id}`) && response.request().method() === 'PATCH');
    await circleDialog.getByRole('button', {name: action, exact: true}).click();
    assert.equal((await circleActionResponse).status(), 200);
    createdCircle = await fixture.db.circle.findUniqueOrThrow({where: {id: createdCircle.id}});
    assert.equal(createdCircle.status, expected.status);
    assert.equal(createdCircle.isFeatured, expected.isFeatured);
  }
  await circleDialog.getByRole('button', {name: '关闭详情'}).last().click();
  await circleDialog.waitFor({state: 'hidden'});
  await fixture.db.circle.delete({where: {id: createdCircle.id}});
  recordOperation('/admin/circles', '站点圈子新增/刷新/公开/推荐/隐藏', {precondition: 'community.write', api: 'POST/GET/PATCH /api/admin/circles', persistence: 'circles + admin_audit_logs', normal: '五类动作通过并清理隔离行', refresh: '通过', failure: '隐藏圈子推荐 409', repeated: '同步双击仅一次 POST', status: '通过'});

  // Seeded character/circle records must open real GET-backed drawers. Exercise
  // dirty close cancellation and acceptance without submitting a new draft.
  await admin.setViewportSize({width: 1440, height: 1000});
  await admin.goto(`${adminOrigin}/admin/characters`);
  await admin.getByPlaceholder('名称、简介或角色编号').fill(seededContent.character.name);
  await admin.getByRole('button', {name: '搜索角色'}).click();
  await admin.getByRole('button', {name: `查看角色 ${seededContent.character.name}`}).click();
  characterDialog = admin.getByRole('dialog', {name: /角色详情/});
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
  circleDialog = admin.getByRole('dialog', {name: /圈子详情/});
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
  const membershipWrites = [];
  const countMembershipWrite = request => {
    if (request.url().endsWith('/api/admin/memberships') && request.method() === 'PATCH') membershipWrites.push(request);
  };
  admin.on('request', countMembershipWrite);
  await admin.getByRole('button', {name: '保存配置'}).evaluate(button => {button.click(); button.click();});
  await admin.getByText('已保存，前台将读取最新方案。', {exact: true}).waitFor({state: 'visible'});
  await admin.waitForTimeout(200);
  admin.off('request', countMembershipWrite);
  assert.equal(membershipWrites.length, 4, 'policy + three plans must be written once each');
  await admin.reload();
  await admin.getByRole('tab', {name: /E2E 月度会员/}).click();
  assert.equal(await admin.getByLabel('方案价格（分）').inputValue(), '177');
  await admin.getByLabel('方案价格（分）').fill('0');
  await admin.getByRole('button', {name: '保存配置'}).click();
  await admin.getByText(/已定价套餐价格必须为正整数分/).waitFor({state: 'visible'});
  await admin.getByLabel('方案价格（分）').fill(originalMonthlyPrice);
  await admin.getByRole('button', {name: '保存配置'}).click();
  await admin.getByText('已保存，前台将读取最新方案。', {exact: true}).waitFor({state: 'visible'});
  report.interactions.membershipDraftSurvivesTabSwitch = {screenshot: membershipShot, persistedAfterReload: true, invalidPriceVisible: true, duplicateSuppressed: true};
  recordOperation('/admin/memberships', '保存退款规则与会员方案', {precondition: 'finance.packages.write + 三个既有方案', api: 'PATCH /api/admin/memberships', persistence: 'membership_policy + membership_plans', normal: '通过并恢复原价', refresh: '通过', failure: '0 分价格在写入前拒绝', repeated: '同步双击仍仅四个预期 PATCH', status: '通过'});

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
