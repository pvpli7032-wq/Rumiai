import {strict as assert} from 'node:assert';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createServer, request as proxyRequest} from 'node:http';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createFixture} from '../helpers/sqlite-fixture.mjs';
import {seedFrontendRouteData} from '../helpers/frontend-redesign-route-fixture.mjs';

if (process.env.DATABASE_URL) throw Error('P2 mobile browser tests require their own isolated database.');
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = fileURLToPath(new URL('../..', import.meta.url));
const portBase = Number(process.env.P2_MOBILE_PORT_BASE || 3650);
const ports = {web: portBase + 1, api: portBase + 2, admin: portBase + 3};
const origin = 'http://127.0.0.1:' + portBase;
const dist = {
  web: process.env.P2_MOBILE_WEB_DIST_DIR || '.next-build',
  api: process.env.P2_MOBILE_API_DIST_DIR || '.next-api',
  admin: process.env.P2_MOBILE_ADMIN_DIST_DIR || '.next-admin',
};
for (const app of ['web', 'api', 'admin']) {
  assert.ok(existsSync(path.join(root, 'apps', app, dist[app], 'BUILD_ID')), 'Build required: ' + app + '/' + dist[app]);
}
const artifacts = path.resolve(process.env.P2_MOBILE_ARTIFACTS || path.join(root,'artifacts','p2-mobile'));
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
const stickerAdminPath = '/admin/chat/stickers';
async function assertNoDialog(page){await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.getByRole('dialog').count(),0);}
async function capture(page,name){const size=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.viewport+1,name+' must not cause horizontal page overflow');await screenshot(page,name);}
try {
  fixture = await createFixture();
  // Match production startup: initialize WAL before concurrent API route clients connect.
  sqliteJournalMode = await fixture.db.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
  const ids = await seedFrontendRouteData(fixture);
  await fixture.db.operationSetting.upsert({where:{key:'memory.enabled'},create:{key:'memory.enabled',group:'growth',value:'true',updatedBy:fixture.admin.id},update:{value:'true'}});
  await fixture.db.user.update({where: {id: fixture.user.id}, data: {avatarUrl: '/brand/persona-0.svg'}});
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

  phase = 'mobile chat layout';
  const chatUrl = origin + '/chat?character=' + encodeURIComponent(ids.characterId) + '&conversation=' + encodeURIComponent(ids.conversationId);
  await front.goto(chatUrl,{waitUntil:'networkidle'});
  await front.getByRole('textbox',{name:'消息内容',exact:true}).waitFor();
  await capture(front,'01-chat-main');
  await front.getByRole('button',{name:'更多消息操作',exact:true}).first().click();
  await front.getByRole('dialog',{name:'消息操作',exact:true}).waitFor();
  await capture(front,'02-message-actions');
  await front.keyboard.press('Escape');
  await assertNoDialog(front);

  await front.getByRole('button',{name:'更多消息操作',exact:true}).last().click();
  await front.getByRole('button',{name:'记住这句',exact:true}).click();
  await front.getByRole('textbox',{name:'要记住的内容',exact:true}).fill('P2 来源记忆');
  const sourceMemoryWrite=front.waitForResponse(r=>r.url().endsWith('/memory')&&r.request().method()==='POST');
  await front.getByRole('button',{name:'确认并保存记忆',exact:true}).click();
  assert.equal((await sourceMemoryWrite).status(),200);
  await front.getByText('已保存为确认记忆，下一轮将按记忆规则参考。',{exact:true}).waitFor();
  await front.getByRole('button',{name:'关闭记住这句',exact:true}).click();
  await assertNoDialog(front);
  await front.getByRole('button',{name:'对话设置',exact:true}).click();
  const settings = front.getByRole('dialog',{name:'对话设置',exact:true});
  await settings.getByText('本次对话中的我',{exact:true}).waitFor();
  await capture(front,'03-conversation-settings');
  for(const [button,title,file] of [['管理身份档案','身份档案','04-personas'],['管理世界书','世界书','05-worldbooks']]){
    await front.getByRole('button',{name:button,exact:true}).click();
    await front.getByRole('dialog',{name:title,exact:true}).waitFor();
    assert.equal(await front.getByRole('dialog').count(),1,'secondary setting replaces one sheet');
    await capture(front,file);
    await front.getByRole('button',{name:'返回对话设置',exact:true}).click();
  }

  await front.getByRole('button',{name:'角色记忆',exact:true}).click();
  await front.getByRole('dialog',{name:'角色记忆',exact:true}).waitFor();
  await front.getByRole('button',{name:'添加记忆',exact:true}).click();
  await front.getByRole('textbox',{name:'新记忆内容',exact:true}).fill('P2 浏览器手工添加的确定记忆');
  const manualMemoryWrite=front.waitForResponse(r=>r.url().endsWith('/memory')&&r.request().method()==='POST');
  await front.getByRole('button',{name:'保存记忆',exact:true}).click();
  assert.equal((await manualMemoryWrite).status(),200);
  await front.getByText('P2 浏览器手工添加的确定记忆',{exact:true}).waitFor();
  await capture(front,'05b-memory-created');
  const sourceRow=front.getByText('P2 来源记忆',{exact:true}).locator('..');
  await sourceRow.getByRole('link',{name:'查看来源',exact:true}).click();
  await front.waitForURL(url=>Boolean(url.searchParams.get('message')));
  await assertNoDialog(front);
  await front.getByText('正在查看搜索定位的消息',{exact:true}).waitFor();
  await capture(front,'05c-memory-source');
  checks.push('message source memory and manual memory persist through POST, source navigation closes sheet and positions original message');

  await front.getByRole('button',{name:'附件工具',exact:true}).click();
  await front.getByRole('dialog',{name:'附件工具',exact:true}).waitFor();
  await front.getByRole('tab',{name:'图片理解',exact:true}).click();
  await capture(front,'06-image-tools');
  await front.getByRole('tab',{name:'录音与转写',exact:true}).click();
  await front.getByRole('button',{name:'开始录音',exact:true}).waitFor();
  await capture(front,'07-voice-tools');
  await front.getByRole('button',{name:'关闭附件工具',exact:true}).click();
  await assertNoDialog(front);
  checks.push('mobile chat primary content, message menu, nested settings, image and voice panels close without stacked dialogs');


  await front.getByRole('button',{name:'更多对话操作',exact:true}).click();
  await front.getByRole('dialog',{name:'对话操作',exact:true}).waitFor();
  await front.getByRole('button',{name:'分享与管理',exact:true}).click();
  const sharePreview=front.getByRole('dialog',{name:'选择分享的内容',exact:true});
  await sharePreview.waitFor();
  await sharePreview.getByRole('checkbox').first().waitFor();
  assert.equal(await front.getByRole('dialog').count(),1,'share preview replaces conversation menu without stacked overlays');
  await capture(front,'02b-share-preview');
  await sharePreview.getByRole('button',{name:'关闭',exact:true}).last().click();
  await assertNoDialog(front);
  checks.push('conversation menu opens share preview as one dialog and closes without publishing');

  phase = 'persisted reader preferences';
  await front.goto(origin+'/profile',{waitUntil:'networkidle'});
  await front.getByText('字体、排版与交互偏好',{exact:true}).click();
  await front.getByRole('combobox',{name:'聊天字号',exact:true}).selectOption('larger');
  const readingSave=front.waitForResponse(r=>r.url().endsWith('/api/users/me')&&r.request().method()==='PUT');
  await front.getByRole('button',{name:'保存设置',exact:true}).click();
  assert.equal((await readingSave).status(),200);
  await front.goto(chatUrl,{waitUntil:'networkidle'});
  const reply=front.getByText('E2E 合成角色回复',{exact:true});
  await reply.waitFor();
  const actualFont=await reply.evaluate(element=>parseFloat(getComputedStyle(element).fontSize));
  assert.equal(actualFont,19,'saved reader font is consumed by the actual message prose');
  await capture(front,'08-reader-font');
  checks.push('reader preference persists through backend and actual assistant prose computes 19px');

  phase = 'discovery preferences';
  await front.goto(origin+'/discover',{waitUntil:'networkidle'});
  const mobileSearch=front.getByRole('searchbox',{name:'搜索角色',exact:true}).filter({visible:true});
  await mobileSearch.fill('E2E 路由角色');
  const saveHistory=front.waitForResponse(r=>r.url().includes('/api/me/discovery-preferences')&&r.request().method()==='PUT');
  await mobileSearch.press('Enter');
  assert.equal((await saveHistory).status(),200);
  await mobileSearch.fill('');
  assert.equal((await userApi(front,'/api/me/hidden-characters/'+ids.characterId,'PUT')).status,200);
  await front.goto(origin+'/discover',{waitUntil:'networkidle'});
  await front.getByText('搜索记录与推荐管理',{exact:true}).filter({visible:true}).click();
  await front.getByRole('button',{name:'E2E 路由角色',exact:true}).filter({visible:true}).waitFor();
  await front.getByText('已隐藏 1 个角色',{exact:true}).filter({visible:true}).click();
  await capture(front,'09-discovery-preferences');
  const restore=front.waitForResponse(r=>r.url().includes('/api/me/hidden-characters/')&&r.request().method()==='DELETE');
  await front.getByRole('button',{name:'恢复推荐',exact:true}).filter({visible:true}).click();
  assert.equal((await restore).status(),200);
  await capture(front,'10-discover-main');
  checks.push('mobile search history and hidden recommendation management reach real APIs');

  phase = 'creator tools';
  await front.goto(origin+'/creator?edit='+encodeURIComponent(ids.ownedCharacterId),{waitUntil:'networkidle'});
  const creatorSummary=front.getByText('创作工具 · 云稿与试聊',{exact:true});
  await creatorSummary.waitFor();
  assert.equal(await creatorSummary.evaluate(el=>el.closest('details').open),false);
  await creatorSummary.click();
  await capture(front,'11-creator-tools');
  await creatorSummary.click();
  assert.equal(await creatorSummary.evaluate(el=>el.closest('details').open),false);
  checks.push('creator cloud/preview tools default collapsed and can close');

  phase = 'story tools';
  await front.goto(origin+'/chat?storyRun='+encodeURIComponent(ids.storyRunId),{waitUntil:'networkidle'});
  const storySummary=front.getByText('故事工具 · 建议、存档与回顾',{exact:true});
  await storySummary.waitFor();
  assert.equal(await storySummary.evaluate(el=>el.closest('details').open),false);
  await storySummary.click();
  if(!await front.getByText('存档与分支',{exact:true}).evaluate(el=>el.closest('details').open))await front.getByText('存档与分支',{exact:true}).click();
  await capture(front,'12-story-tools');
  await storySummary.click();
  assert.equal(await storySummary.evaluate(el=>el.closest('details').open),false);
  checks.push('story save/timeline tools default collapsed and close without covering story');

  await storySummary.click();
  if(!await front.getByText('存档与分支',{exact:true}).evaluate(el=>el.closest('details').open))await front.getByText('存档与分支',{exact:true}).click();
  await front.getByRole('textbox',{name:'存档名称',exact:true}).fill('P2 浏览器分支存档');
  const saveStory=front.waitForResponse(r=>r.url().endsWith('/saves')&&r.request().method()==='POST');
  await front.getByRole('button',{name:'存档',exact:true}).click();
  assert.equal((await saveStory).status(),200);
  await front.getByText('P2 浏览器分支存档',{exact:true}).waitFor();
  const restoredStory=front.waitForResponse(r=>r.url().endsWith('/saves')&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='restore');
  front.once('dialog',dialog=>void dialog.accept());
  await front.getByRole('button',{name:'恢复新分支',exact:true}).click();
  const restoredResponse=await restoredStory;
  assert.equal(restoredResponse.status(),200);
  const restoredBody=await restoredResponse.json();
  assert.notEqual(restoredBody.run.id,ids.storyRunId);
  await front.waitForURL(url=>url.searchParams.get('storyRun')===restoredBody.run.id);
  await front.getByText('故事工具 · 建议、存档与回顾',{exact:true}).waitFor();
  await capture(front,'12b-restored-story-branch');
  checks.push('save restoration POST creates independent run and navigates to working storyRun route');

  
  phase = 'admin sticker catalogue';
  const baselineStickers=await (await front.request.get(origin+'/api/chat/stickers')).json();
  assert.ok(baselineStickers.length>0,'fixture has existing active stickers');
  const adminContext=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});
  contexts.push(adminContext);trackNetwork(adminContext);
  const admin=await adminContext.newPage();
  admin.on('pageerror',e=>pageErrors.push(e.message));
  await admin.goto(origin+'/admin/login',{waitUntil:'domcontentloaded'});
  await admin.getByLabel('登录邮箱',{exact:true}).fill(fixture.admin.email);
  await admin.getByLabel('密码',{exact:true}).fill(fixture.password);
  const loginAdmin=admin.waitForResponse(r=>r.url().includes('/api/admin/auth/login')&&r.request().method()==='POST');
  await admin.getByRole('button',{name:'登录管理中心',exact:true}).click();
  assert.equal((await loginAdmin).status(),200);
  await admin.waitForURL(url=>url.pathname!=='/admin/login');
  await admin.goto(origin+stickerAdminPath,{waitUntil:'networkidle'});
  await admin.getByRole('button',{name:'新增表情',exact:true}).click();
  await admin.getByLabel('标识',{exact:true}).fill('p2-mobile-fixture');
  await admin.getByLabel('名称',{exact:true}).fill('P2 浏览器表情');
  await admin.getByLabel('表情内容',{exact:true}).fill('🌷');
  await admin.getByLabel('在聊天选择器上架',{exact:true}).check();
  const createSticker=admin.waitForResponse(r=>r.url().includes('/api/admin/chat/stickers')&&r.request().method()==='POST');
  await admin.getByRole('button',{name:'保存',exact:true}).click();
  assert.equal((await createSticker).status(),200);
  await screenshot(admin,'13-admin-sticker');
  await front.goto(chatUrl,{waitUntil:'networkidle'});
  await front.getByRole('button',{name:'选择表情包',exact:true}).click();
  const sticker=front.getByRole('button',{name:'P2 浏览器表情',exact:true});
  await sticker.waitFor();
  const sendSticker=front.waitForResponse(r=>r.url().includes('/attachments')&&r.request().method()==='POST');
  await sticker.click();
  assert.equal((await sendSticker).status(),201);
  await front.getByRole('img',{name:'P2 浏览器表情',exact:true}).waitFor();
  await capture(front,'14-sticker-message');
  const row=admin.getByText('P2 浏览器表情',{exact:true}).locator('..').locator('..');
  await row.getByRole('button',{name:'编辑',exact:true}).click();
  await admin.getByLabel('在聊天选择器上架',{exact:true}).uncheck();
  const unlist=admin.waitForResponse(r=>r.url().includes('/api/admin/chat/stickers')&&r.request().method()==='POST');
  await admin.getByRole('button',{name:'保存',exact:true}).click();
  assert.equal((await unlist).status(),200);
  await front.reload({waitUntil:'networkidle'});
  await front.getByRole('img',{name:'P2 浏览器表情',exact:true}).waitFor();
  const catalogueRead=front.waitForResponse(r=>r.url().endsWith('/api/chat/stickers')&&r.request().method()==='GET');
  await front.getByRole('button',{name:'选择表情包',exact:true}).click();
  const catalogueAfterUnlist=await catalogueRead;
  assert.equal(catalogueAfterUnlist.status(),200);
  const remainingStickers=await catalogueAfterUnlist.json();
  assert.deepEqual(remainingStickers.map(item=>item.id).sort(),baselineStickers.map(item=>item.id).sort(),'unlisting one item preserves the original active catalogue');
  assert.ok(!remainingStickers.some(item=>item.id==='p2-mobile-fixture'));
  assert.equal(await front.getByRole('button',{name:'P2 浏览器表情',exact:true}).count(),0);
  for(const item of remainingStickers)await front.getByRole('button',{name:item.label,exact:true}).waitFor();
  await capture(front,'15-sticker-unlisted-history');
  checks.push('admin creates active sticker, frontend sends real attachment, unlist removes picker but preserves historical snapshot');
  assert.deepEqual(blockedRequests,[],'browser fixture does not request external providers');
  const checkout=await front.request.get(origin+'/api/coins/packages');
  assert.equal(checkout.headers()['x-checkout-enabled'],'false');
  assert.deepEqual(pageErrors,[]);
  const result={status:'PASS',checks,artifacts,syntheticDatabase:true,realAI:false,realPayment:false,realEmail:false,screenshotsRequireHumanReview:true};
  writeFileSync(path.join(artifacts,'result.json'),JSON.stringify(result,null,2));
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
