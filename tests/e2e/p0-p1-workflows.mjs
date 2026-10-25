import {strict as assert} from 'node:assert';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createServer, request as proxyRequest} from 'node:http';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createFixture} from '../helpers/sqlite-fixture.mjs';
import {seedFrontendRouteData} from '../helpers/frontend-redesign-route-fixture.mjs';

if (process.env.DATABASE_URL) throw Error('P0/P1 browser tests require their own isolated database.');
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = fileURLToPath(new URL('../..', import.meta.url));
const portBase = Number(process.env.P0_P1_PORT_BASE || 3550);
const ports = {web: portBase + 1, api: portBase + 2, admin: portBase + 3};
const origin = 'http://127.0.0.1:' + portBase;
const dist = {
  web: process.env.P0_P1_WEB_DIST_DIR || '.next-build',
  api: process.env.P0_P1_API_DIST_DIR || '.next-api',
  admin: process.env.P0_P1_ADMIN_DIST_DIR || '.next-admin',
};
for (const app of ['web', 'api', 'admin']) {
  assert.ok(existsSync(path.join(root, 'apps', app, dist[app], 'BUILD_ID')), 'Build required: ' + app + '/' + dist[app]);
}
const artifacts = path.resolve(process.env.P0_P1_ARTIFACTS || path.join('/tmp', 'rumiai-p0-p1-browser-' + Date.now()));
mkdirSync(artifacts, {recursive: true});
const children = [], contexts = [], pageErrors = [], blockedRequests = [];
const requestCounts = new Map(), pendingRequests = new Map();
function trackNetwork(context) {
  context.on('request', request => {const pathname = new URL(request.url()).pathname; const key = phase + ' ' + request.method() + ' ' + pathname; requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1); pendingRequests.set(request, {phase, method: request.method(), pathname});});
  context.on('requestfinished', request => pendingRequests.delete(request));
  context.on('requestfailed', request => pendingRequests.delete(request));
}
let fixture, browser, proxy, phase = 'bootstrap';
let sqliteJournalMode = null;
const endpointTimings = [];
const checks = [];
function start(app, env) {
  const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '-p', String(ports[app])], {
    cwd: path.join(root, 'apps', app), env: {...env, NEXT_DIST_DIR: dist[app]}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const record = {app, child, output: '', closed: null};
  record.closed = new Promise(resolve => child.once('close', resolve));
  child.on('error', error => {record.output += error.message;});
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {record.output += data.toString();});
  children.push(record);
}
async function ready(url) {
  for (let i = 0; i < 90; i++) {
    const failed = children.find(item => item.child.exitCode !== null || item.child.signalCode !== null);
    if (failed) throw Error('Fixture service exited: ' + failed.app + '\n' + failed.output);
    try {if ((await fetch(url, {signal: AbortSignal.timeout(1500)})).status < 500) return;} catch {}
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw Error('Fixture service not ready: ' + url);
}
async function stop() {
  await Promise.all(contexts.map(context => context.close().catch(() => {})));
  await browser?.close();
  if (proxy) await new Promise(resolve => proxy.close(resolve));
  await Promise.all(children.map(async ({child, closed}) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    let timer;
    await Promise.race([closed, new Promise(resolve => {timer = setTimeout(() => {child.kill('SIGKILL'); resolve();}, 8000);})]);
    clearTimeout(timer);
  }));
  await fixture?.cleanup();
}
async function userApi(page, route, method = 'GET', body) {
  return page.evaluate(async ({route, method, body}) => {
    const token = localStorage.getItem('xingban_token');
    const response = await fetch(route, {
      method, headers: {Authorization: 'Bearer ' + token, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}), cache: 'no-store',
    });
    return {status: response.status, body: await response.json().catch(() => null)};
  }, {route, method, body});
}
async function screenshot(page, name) {
  await page.screenshot({path: path.join(artifacts, name + '.png'), fullPage: false});
}
try {
  fixture = await createFixture();
  // Match production startup: initialize WAL before concurrent API route clients connect.
  sqliteJournalMode = await fixture.db.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
  const ids = await seedFrontendRouteData(fixture);
  await fixture.db.user.update({where: {id: fixture.user.id}, data: {avatarUrl: '/brand/persona-0.svg'}});
  const paidOrder = await fixture.db.membershipOrder.findUniqueOrThrow({where: {orderNo: ids.membershipPaidOrderNo}});
  await fixture.db.membershipOrder.update({where: {id: paidOrder.id}, data: {benefitsJson: JSON.stringify([{key: 'DAILY_FREE_REPLIES', label: 'E2E 免费回复', value: 5}])}});
  await fixture.db.membershipUsage.createMany({data: ['CONSUMED', 'RESERVED', 'RELEASED'].map((state, index) => ({orderId: paidOrder.id, userId: fixture.user.id, benefitCode: 'DAILY_FREE_REPLIES', quantity: 1, state, idempotencyKey: 'p1-browser-usage-' + index}))});
  const manifest = {synthetic: true, login: {email: fixture.user.email, password: fixture.password}, adminLogin: {email: fixture.admin.email, password: fixture.password}, ids, webBaseUrl: origin};
  // This manifest contains only disposable fixture credentials and is kept in server test artifacts.
  writeFileSync(path.join(artifacts, 'fixture-manifest.json'), JSON.stringify(manifest, null, 2));
  const env = {
    ...process.env,
    DATABASE_URL: 'file:' + fixture.dbPath,
    UPLOADS_DIRECTORY: path.join(fixture.dir, 'uploads'),
    BACKUPS_DIRECTORY: path.join(fixture.dir, 'backups'),
    INTERNAL_API_ORIGIN: 'http://127.0.0.1:' + ports.api,
    ADMIN_API_INTERNAL_URL: 'http://127.0.0.1:' + ports.api,
    INTERNAL_ADMIN_ORIGIN: 'http://127.0.0.1:' + ports.admin,
    ADMIN_PUBLIC_ORIGIN: origin,
    NEXT_PUBLIC_SITE_URL: origin,
    WEB_PORT: String(ports.web), API_PORT: String(ports.api), ADMIN_PORT: String(ports.admin),
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    JWT_SECRET: 'p0-p1-isolated-browser-secret-012345678901234567890123',
    EZFP_ENABLED: 'false', EZFP_REFUNDS_ENABLED: 'false', EZFP_PID: '',
    EZFP_MERCHANT_PRIVATE_KEY: '', EZFP_PLATFORM_PUBLIC_KEY: '',
    OPENAI_API_KEY: '', AI_API_KEY: '', DISABLE_MOCK_AI: 'true',
    ACCOUNT_EMAIL_DELIVERY: '', RESEND_API_KEY: '', ACCOUNT_EMAIL_FROM: '',
    STORY_WORKER_DISABLED: '1',
  };
  for (const app of ['api', 'admin', 'web']) start(app, env);
  proxy = createServer((req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    const app = pathname.startsWith('/api/') ? 'api' : pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/admin-assets/') ? 'admin' : 'web';
    const target = 'http://127.0.0.1:' + ports[app];
    const upstream = proxyRequest(target + (req.url || '/'), {method: req.method, headers: {...req.headers, host: new URL(target).host, 'x-forwarded-host': req.headers.host, 'x-forwarded-proto': 'http'}}, reply => {
      res.writeHead(reply.statusCode || 502, reply.headers); reply.pipe(res);
    });
    upstream.on('error', () => {if (!res.headersSent) res.writeHead(502); res.end('fixture upstream unavailable');});
    req.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(portBase, '127.0.0.1', resolve));
  await Promise.all([ready(origin + '/login'), ready(origin + '/admin/login'), ready(origin + '/api/operations/status')]);
  const startupCheckoutStarted = Date.now();
  const startupCheckout = await fetch(origin + '/api/coins/packages', {signal: AbortSignal.timeout(10_000)});
  const startupCheckoutBody = await startupCheckout.text();
  endpointTimings.push({pathname: '/api/coins/packages', via: 'fixture-proxy', status: startupCheckout.status, elapsedMs: Date.now() - startupCheckoutStarted, bodyBytes: Buffer.byteLength(startupCheckoutBody), checkoutEnabled: startupCheckout.headers.get('x-checkout-enabled')});
  assert.equal(startupCheckout.status, 200);
  assert.equal(startupCheckout.headers.get('x-checkout-enabled'), 'false');
  browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/lib64/chromium-browser/headless_shell'});
  const context = await browser.newContext({serviceWorkers: 'block', viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  contexts.push(context);trackNetwork(context);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      blockedRequests.push(url.origin); return route.abort();
    }
    return route.continue();
  });
  const front = await context.newPage();
  front.on('pageerror', error => pageErrors.push(error.message));
  phase = 'user login';
  await front.goto(origin + '/login?next=/profile', {waitUntil: 'domcontentloaded'});
  await front.locator('#login-email').fill(manifest.login.email);
  await front.locator('#login-password').fill(manifest.login.password);
  const loginResult = front.waitForResponse(response => response.url().includes('/api/auth/login') && response.request().method() === 'POST');
  await front.getByRole('button', {name: '登录', exact: true}).click();
  assert.equal((await loginResult).status(), 200);
  await front.waitForFunction(() => Boolean(localStorage.getItem('xingban_token')));
  phase = 'reading error recovery';
  let forcedFailure = false;
  let forceReadingFailure = true;
  await front.route('**/api/users/me', route => {
    if (forceReadingFailure && route.request().method() === 'GET') {
      forcedFailure = true;
      return route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: '隔离测试：阅读设置读取失败'})});
    }
    return route.continue();
  });
  await front.goto(origin + '/profile', {waitUntil: 'networkidle'});
  const retry = front.getByRole('button', {name: '重新加载', exact: true});
  await retry.waitFor();
  assert.ok(forcedFailure);
  await screenshot(front, 'reading-error-mobile');
  forceReadingFailure = false;
  await retry.click();
  await front.getByRole('button', {name: '阅读模式', exact: true}).waitFor();
  await front.unroute('**/api/users/me');
  const before = await userApi(front, '/api/users/me');
  assert.equal(before.status, 200);
  const readingButton = front.getByRole('button', {name: '阅读模式', exact: true});
  await readingButton.click();
  const readingWrite = front.waitForResponse(response => response.url().endsWith('/api/users/me') && response.request().method() === 'PUT');
  await front.getByRole('button', {name: '保存设置', exact: true}).click();
  assert.equal((await readingWrite).status(), 200);
  const afterReading = await userApi(front, '/api/users/me');
  assert.equal(afterReading.body.user.readingMode, !before.body.user.readingMode);
  checks.push('reading failure retry and durable save');
  phase = 'profile write and clear avatar';
  await front.getByRole('button', {name: '编辑资料', exact: true}).click();
  await front.getByLabel('昵称', {exact: true}).fill('P1 已修改资料');
  await front.getByRole('button', {name: '移除头像', exact: true}).click();
  const profileWrite = front.waitForResponse(response => response.url().endsWith('/api/users/me') && response.request().method() === 'PUT');
  await front.getByRole('button', {name: '保存资料', exact: true}).click();
  assert.equal((await profileWrite).status(), 200);
  await front.getByRole('heading', {name: 'P1 已修改资料', exact: true}).waitFor();
  const ownProfile = await userApi(front, '/api/users/me');
  assert.equal(ownProfile.body.user.avatarUrl, null);
  assert.equal(ownProfile.body.user.displayName, 'P1 已修改资料');
  await front.reload({waitUntil: 'networkidle'});
  await front.getByRole('heading', {name: 'P1 已修改资料', exact: true}).waitFor();
  await screenshot(front, 'profile-saved-mobile');
  checks.push('profile write, clear avatar and refresh');
  phase = 'membership endpoint readiness';
  const checkoutStarted = Date.now();
  const directCheckout = await fetch('http://127.0.0.1:' + ports.api + '/api/coins/packages', {signal: AbortSignal.timeout(15_000)});
  const directCheckoutBody = await directCheckout.text();
  endpointTimings.push({pathname: '/api/coins/packages', via: 'direct-api', status: directCheckout.status, elapsedMs: Date.now() - checkoutStarted, bodyBytes: Buffer.byteLength(directCheckoutBody), checkoutEnabled: directCheckout.headers.get('x-checkout-enabled')});
  assert.equal(directCheckout.status, 200);
  assert.equal(directCheckout.headers.get('x-checkout-enabled'), 'false');
  phase = 'membership usage details';
  await front.goto(origin + '/membership', {waitUntil: 'networkidle'});
  const paidRow = front.getByRole('article', {name: '会员订单 ' + ids.membershipPaidOrderNo, exact: true});
  await paidRow.getByRole('button', {name: '查看权益使用明细', exact: true}).click();
  await paidRow.getByText('E2E 免费回复', {exact: false}).first().waitFor();
  await paidRow.getByText('已释放', {exact: false}).first().waitFor();
  const usageFirst = await userApi(front, '/api/me/membership/usage?orderNo=' + ids.membershipPaidOrderNo + '&limit=1');
  assert.equal(usageFirst.status, 200);
  assert.equal(usageFirst.body.items.length, 1);
  assert.ok(usageFirst.body.nextCursor);
  const usageSecond = await userApi(front, '/api/me/membership/usage?orderNo=' + ids.membershipPaidOrderNo + '&limit=1&cursor=' + encodeURIComponent(usageFirst.body.nextCursor));
  assert.equal(usageSecond.status, 200);
  assert.notEqual(usageFirst.body.items[0].id, usageSecond.body.items[0].id);
  assert.equal((await front.request.get(origin + '/api/me/membership/usage?orderNo=' + ids.membershipPaidOrderNo)).status(), 401);
  await screenshot(front, 'membership-usage-mobile');
  checks.push('real order usage UI and stable cursor pages');

  phase = 'mobile chat input and message actions';
  await front.goto(origin + '/chat?character=' + encodeURIComponent(ids.characterId) + '&conversation=' + encodeURIComponent(ids.conversationId), {waitUntil: 'networkidle'});
  const composer = front.getByRole('textbox', {name: '消息内容', exact: true});
  await composer.waitFor();
  assert.equal(await composer.evaluate(element => element.tagName), 'TEXTAREA', 'mobile chat accepts multiple lines');
  const messagesBeforeDraft = await fixture.db.message.count({where: {conversationId: ids.conversationId}});
  await composer.fill('第一行草稿\n第二行草稿');
  await composer.press('Enter');
  const mobileDraft = '第一行草稿\n第二行草稿\n';
  assert.equal(await composer.inputValue(), mobileDraft, 'mobile Enter inserts a newline instead of sending');
  assert.ok(await composer.evaluate(element => element.clientHeight > 44), 'composer grows with multiple lines');
  await front.reload({waitUntil: 'networkidle'});
  await front.waitForFunction(expected => document.querySelector('textarea[aria-label="消息内容"]')?.value === expected, mobileDraft);
  assert.equal(await fixture.db.message.count({where: {conversationId: ids.conversationId}}), messagesBeforeDraft, 'draft and refresh never send an AI message');
  const draftOwner = await front.evaluate(({userId, conversationId}) => {
    const saved = JSON.parse(localStorage.getItem('xingban:chat-draft:' + userId + ':' + conversationId) || 'null');
    return saved?.input;
  }, {userId: fixture.user.id, conversationId: ids.conversationId});
  assert.equal(draftOwner, mobileDraft, 'draft is scoped to the actual signed-in account and conversation');
  const moreMessage = front.getByLabel('更多消息操作', {exact: true}).first();
  await moreMessage.click();
  assert.equal(await moreMessage.evaluate(element => element.closest('details').open), true);
  await moreMessage.press('Escape');
  assert.equal(await moreMessage.evaluate(element => element.closest('details').open), false, 'Escape closes message actions');
  assert.equal(await moreMessage.evaluate(element => document.activeElement === element), true, 'closing actions restores keyboard focus');
  assert.match(await front.locator('p > time').first().innerText(), /\d{4}年\d{1,2}月\d{1,2}日/, 'history has readable date separators');
  await front.getByText('已保存', {exact: true}).first().waitFor();
  const selectedText = await front.getByText('E2E 合成用户消息', {exact: true}).evaluate(element => {
    const selection = window.getSelection(), range = document.createRange();
    range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range);
    return {text: selection.toString(), select: getComputedStyle(element.closest('.select-text')).userSelect};
  });
  assert.equal(selectedText.text, 'E2E 合成用户消息');
  assert.equal(selectedText.select, 'text', 'message text remains selectable alongside actions');
  await screenshot(front, 'chat-draft-actions-mobile');
  await composer.fill('');
  checks.push('mobile multiline, account-scoped draft refresh, native text selection, message menu Escape and saved/date states');

  phase = 'share preview and revoke';
  const privateRead = await front.request.get(origin + '/api/public-conversations/' + ids.conversationId);
  assert.equal(privateRead.status(), 404, 'raw conversation id must never authorize sharing');
  await front.goto(origin + '/chat?character=' + encodeURIComponent(ids.characterId) + '&conversation=' + encodeURIComponent(ids.conversationId), {waitUntil: 'networkidle'});
  await front.getByRole('button', {name: '分享与管理', exact: true}).click();
  const shareDialog = front.getByRole('dialog', {name: '选择分享的内容', exact: true});
  await shareDialog.getByRole('checkbox').first().waitFor();
  await shareDialog.getByRole('checkbox').first().check();
  const shareWrite = front.waitForResponse(response => response.url().includes('/api/conversations/' + ids.conversationId + '/share') && response.request().method() === 'POST');
  await shareDialog.getByRole('button', {name: '确认公开所选文字', exact: true}).click();
  const shareResponse = await shareWrite;
  assert.equal(shareResponse.status(), 200);
  const share = await shareResponse.json();
  assert.equal(share.turnCount, 1);
  const anonymous = await browser.newContext({serviceWorkers: 'block', viewport: {width: 390, height: 844}});
  contexts.push(anonymous);
  const shared = await anonymous.request.get(origin + '/api/public-conversations/' + share.id);
  assert.equal(shared.status(), 200);
  const snapshot = await shared.json();
  assert.equal(snapshot.messages.length, 1);
  await fixture.db.message.create({data: {conversationId: ids.conversationId, role: 'USER', content: 'P0 后续私聊不得公开'}});
  const unchanged = await (await anonymous.request.get(origin + '/api/public-conversations/' + share.id)).json();
  assert.equal(unchanged.messages.length, 1);
  assert.ok(!JSON.stringify(unchanged).includes('P0 后续私聊不得公开'));
  await screenshot(front, 'share-preview-mobile');
  const revokeWrite = front.waitForResponse(response => response.url().includes('/api/conversations/' + ids.conversationId + '/share') && response.request().method() === 'DELETE');
  await shareDialog.getByRole('button', {name: '撤销', exact: true}).first().click();
  assert.equal((await revokeWrite).status(), 200);
  assert.equal((await anonymous.request.get(origin + '/api/public-conversations/' + share.id)).status(), 404);
  checks.push('explicit share preview, fixed snapshot and revoke');
  phase = 'admin settings and profile linkage';
  const adminContext = await browser.newContext({serviceWorkers: 'block', viewport: {width: 1440, height: 1000}});
  contexts.push(adminContext);trackNetwork(adminContext);
  const admin = await adminContext.newPage();
  admin.on('pageerror', error => pageErrors.push(error.message));
  await admin.goto(origin + '/admin/login', {waitUntil: 'domcontentloaded'});
  await admin.getByLabel('登录邮箱', {exact: true}).fill(manifest.adminLogin.email);
  await admin.getByLabel('密码', {exact: true}).fill(manifest.adminLogin.password);
  const adminLogin = admin.waitForResponse(response => response.url().includes('/api/admin/auth/login') && response.request().method() === 'POST');
  await admin.getByRole('button', {name: '登录管理中心', exact: true}).click();
  assert.equal((await adminLogin).status(), 200);
  await admin.waitForURL(url => url.pathname !== '/admin/login');
  const managedResponse = await admin.request.get(origin + '/api/admin/accounts/' + fixture.user.id + '/profile');
  assert.equal(managedResponse.status(), 200);
  const managed = await managedResponse.json();
  assert.equal(managed.displayName, 'P1 已修改资料');
  assert.equal(managed.avatarUrl, null);
  await admin.goto(origin + '/admin/settings?tab=chat', {waitUntil: 'networkidle'});
  const chatNav = admin.getByRole('navigation', {name: /小节/});
  for (const name of ['关系与成长', '聊天分享', '接话建议', '上传']) await chatNav.getByRole('button', {name: new RegExp(name)}).waitFor();
  await chatNav.getByRole('button', {name: /关系与成长/}).click();
  await admin.getByText('恋爱值等级', {exact: true}).waitFor();
  await screenshot(admin, 'settings-relationship-desktop');
  await admin.goto(origin + '/admin/settings?tab=growth', {waitUntil: 'networkidle'});
  await admin.getByRole('navigation', {name: /小节/}).getByRole('button', {name: /发现与推荐/}).click();
  await admin.getByText('发现分区角色数', {exact: true}).waitFor();
  await screenshot(admin, 'settings-recommendation-desktop');
  await admin.goto(origin + '/admin/settings?tab=chat&section=chat-sharing', {waitUntil: 'networkidle'});
  await admin.getByLabel('单次分享消息上限', {exact: true}).fill('3');
  const settingsWrite = admin.waitForResponse(response => response.url().includes('/api/admin/settings') && response.request().method() === 'PATCH');
  await admin.getByRole('button', {name: '保存本页', exact: true}).click();
  assert.equal((await settingsWrite).status(), 200);
  const configuredSharePreview = await userApi(front, '/api/conversations/' + ids.conversationId + '/share');
  assert.equal(configuredSharePreview.status, 200);
  assert.equal(configuredSharePreview.body.maxMessages, 3, 'admin setting must be consumed by storefront share preview');
  const secondIdentity = await admin.request.post(origin + '/api/auth/login', {data: {email: fixture.admin.email, password: fixture.password}});
  assert.equal(secondIdentity.status(), 200);
  const foreignBearer = (await secondIdentity.json()).token;
  const foreignUsage = await admin.request.get(origin + '/api/me/membership/usage?orderNo=' + ids.membershipPaidOrderNo, {headers: {Authorization: 'Bearer ' + foreignBearer}});
  assert.equal(foreignUsage.status(), 404, 'another signed-in account cannot read these usage records');
  checks.push('admin sections, profile linkage, settings consumed and usage ownership');
  phase = 'checkout remains closed';
  const checkout = await front.request.get(origin + '/api/coins/packages');
  assert.equal(checkout.headers()['x-checkout-enabled'], 'false');
  assert.equal(checkout.headers()['x-checkout-reason'], 'CHECKOUT_DISABLED');
  assert.deepEqual(pageErrors, [], 'no unhandled browser errors');
  assert.deepEqual(blockedRequests, [], 'no external calls in these isolated workflows');
  const result = {status: 'PASS', checks, artifacts, syntheticDatabase: true, realPayment: false, realAI: false, realEmail: false, sqliteJournalMode, endpointTimings, requestCounts: Object.fromEntries(requestCounts), pendingRequests: [...pendingRequests.values()]};
  writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  const failureScreenshots = [];
  await Promise.all(contexts.flatMap(context => context.pages()).map(async (page, index) => {
    try {const filename = path.join(artifacts, 'failure-' + index + '.png'); await page.screenshot({path: filename, fullPage: false}); failureScreenshots.push(filename);} catch { /* The page may already have closed after the original error. */ }
  }));
  const result = {status: 'FAIL', failureScreenshots, phase, error: String(error), stack: error?.stack, checks, pageErrors, blockedRequests, artifacts, requestCounts: Object.fromEntries(requestCounts), pendingRequests: [...pendingRequests.values()], serviceLogs: children.map(({app, output}) => ({app, output: output.slice(-6000)}))};
  writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify(result, null, 2));
  console.error(JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await stop();
}
