import {strict as assert} from 'node:assert';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createServer, request as proxyRequest} from 'node:http';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createFixture} from '../helpers/sqlite-fixture.mjs';
import {seedFrontendRouteData} from '../helpers/frontend-redesign-route-fixture.mjs';

if (process.env.DATABASE_URL) throw Error('Chat settings browser tests require their own isolated database.');
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = fileURLToPath(new URL('../..', import.meta.url));
const portBase = Number(process.env.CHAT_SETTINGS_PORT_BASE || 3750);
const ports = {web: portBase + 1, api: portBase + 2, admin: portBase + 3};
const origin = 'http://127.0.0.1:' + portBase;
const dist = {
  web: process.env.CHAT_SETTINGS_WEB_DIST_DIR || '.next-build',
  api: process.env.CHAT_SETTINGS_API_DIST_DIR || '.next-api',
  admin: process.env.CHAT_SETTINGS_ADMIN_DIST_DIR || '.next-admin',
};
for (const app of ['web', 'api', 'admin']) {
  assert.ok(existsSync(path.join(root, 'apps', app, dist[app], 'BUILD_ID')), 'Build required: ' + app + '/' + dist[app]);
}
const artifacts = path.resolve(process.env.CHAT_SETTINGS_ARTIFACTS || path.join(root,'artifacts','chat-settings'));
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
async function openMenu(page, tab){
  const trigger=page.getByRole('button',{name:'更多对话操作',exact:true});
  await trigger.click();
  const menu=page.getByRole('dialog',{name:'聊天与设置',exact:true});
  await menu.waitFor();
  const box=await menu.boundingBox();const height=await page.evaluate(()=>innerHeight);
  assert.ok(box.height>=height*.45&&box.height<=height*.55,'menu should occupy half the phone screen');
  assert.equal(await page.getByRole('dialog').count(),1,'one visible drawer');
  await menu.getByRole('tab',{name:tab,exact:true}).click();
  assert.equal(await menu.getByRole('tab',{name:tab,exact:true}).getAttribute('aria-selected'),'true');
}
async function assertNoDialog(page){await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.getByRole('dialog').count(),0);}
async function capture(page,name){const size=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.viewport+1,name+' must not cause horizontal page overflow');await screenshot(page,name);}
try {
  fixture = await createFixture();
  // Match production startup: initialize WAL before concurrent API route clients connect.
  sqliteJournalMode = await fixture.db.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
  const ids = await seedFrontendRouteData(fixture);
  await fixture.db.operationSetting.upsert({where:{key:'memory.enabled'},create:{key:'memory.enabled',group:'growth',value:'false',updatedBy:fixture.admin.id},update:{value:'false'}});
  await fixture.db.operationSetting.upsert({where:{key:'story.enabled'},create:{key:'story.enabled',group:'growth',value:'true',updatedBy:fixture.admin.id},update:{value:'true'}});
  const covered=await fixture.db.message.findFirstOrThrow({where:{conversationId:ids.conversationId,role:'ASSISTANT'},select:{id:true}});
  await fixture.db.conversationMemory.create({data:{conversationId:ids.conversationId,summary:'专项测试初始摘要：约好下次聊海边。',coveredMessageId:covered.id,version:0}});
  await fixture.db.memoryFact.create({data:{userId:fixture.user.id,conversationId:ids.conversationId,text:'专项测试待确认候选',status:'PENDING'}});
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


  const chatUrl=origin+'/chat?character='+encodeURIComponent(ids.characterId)+'&conversation='+encodeURIComponent(ids.conversationId);
  const adminContext=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});
  contexts.push(adminContext);trackNetwork(adminContext);
  await adminContext.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(['http:','https:'].includes(url.protocol)&&!['127.0.0.1','localhost'].includes(url.hostname)){blockedRequests.push(url.origin);return route.abort();}
    return route.continue();
  });
  const admin=await adminContext.newPage();
  admin.on('pageerror',error=>pageErrors.push(error.message));
  phase='admin independent login';
  await admin.goto(origin+'/admin/login',{waitUntil:'domcontentloaded'});
  await admin.getByLabel('登录邮箱',{exact:true}).fill(fixture.admin.email);
  await admin.getByLabel('密码',{exact:true}).fill(fixture.password);
  const adminLogin=admin.waitForResponse(r=>r.url().includes('/api/admin/auth/login')&&r.request().method()==='POST');
  await admin.getByRole('button',{name:'登录管理中心',exact:true}).click();
  assert.equal((await adminLogin).status(),200);
  await admin.waitForURL(url=>url.pathname!=='/admin/login');

  async function saveAdmin(){
    const saved=admin.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/settings'&&r.request().method()==='PATCH');
    await admin.getByRole('region',{name:'保存栏',exact:true}).getByRole('button',{name:'保存本页',exact:true}).click();
    const response=await saved;assert.equal(response.status(),200);return response.json();
  }
  async function addOption(key,label,value,instruction){
    const container=admin.locator('[data-setting-key="'+key+'"]');
    await container.waitFor();
    await container.getByRole('button',{name:'添加选项',exact:true}).click();
    const option=container.locator('fieldset').last();
    await option.getByLabel('前台名称',{exact:true}).fill(label);
    await option.getByLabel('唯一标识',{exact:true}).fill(value);
    await option.getByLabel('生成时执行的指令',{exact:true}).fill(instruction);
  }

  phase='admin chat response configuration';
  await admin.goto(origin+'/admin/chat/settings?tab=chat&section=chat-response',{waitUntil:'domcontentloaded'});
  assert.equal(new URL(admin.url()).pathname,'/admin/chat/settings');
  await addOption('chat.responseStyles','专项自然风格','browser-natural','仅供隔离测试：语气自然、简洁，不生成付费请求。');
  await saveAdmin();
  await capture(admin,'01-admin-chat-settings');
  const storedStyles=JSON.parse((await fixture.db.operationSetting.findUniqueOrThrow({where:{key:'chat.responseStyles'}})).value);
  assert.ok(storedStyles.some(style=>style.key==='browser-natural'&&style.label==='专项自然风格'));
  checks.push('independent admin/chat/settings saves visual response option fields to the real settings API');

  phase='admin memory enable';
  await admin.goto(origin+'/admin/chat/memory?tab=growth&section=growth-memory',{waitUntil:'domcontentloaded'});
  assert.equal(new URL(admin.url()).pathname,'/admin/chat/memory');
  const memorySwitch=admin.locator('[data-setting-key="memory.enabled"]').getByRole('switch');
  await memorySwitch.waitFor();await memorySwitch.check();
  await saveAdmin();
  assert.equal((await fixture.db.operationSetting.findUniqueOrThrow({where:{key:'memory.enabled'}})).value,'true');
  await capture(admin,'02-admin-chat-memory');
  checks.push('independent admin/chat/memory enables actual memory policy through its visible switch');

  phase='admin story configuration';
  await admin.goto(origin+'/admin/stories/settings?tab=billing&section=billing-story-settings',{waitUntil:'domcontentloaded'});
  assert.equal(new URL(admin.url()).pathname,'/admin/stories/settings');
  await addOption('story.narrativeStyles','专项电影叙事','browser-cinematic','仅供隔离测试：镜头清楚，以场景和行动推进。');
  await saveAdmin();
  await capture(admin,'03-admin-story-settings');
  const storedNarrative=JSON.parse((await fixture.db.operationSetting.findUniqueOrThrow({where:{key:'story.narrativeStyles'}})).value);
  assert.ok(storedNarrative.some(style=>style.key==='browser-cinematic'));
  checks.push('independent admin/stories/settings saves configured narrative options with visible fields');

  if (!process.env.CHAT_DRAWER_STORY_ONLY) {
  phase='mobile drawer real chat actions';
  await front.goto(chatUrl,{waitUntil:'domcontentloaded'});
  await front.getByRole('textbox',{name:'消息内容',exact:true}).waitFor();
  await openMenu(front,'聊天');
  await capture(front,'00-mobile-chat-drawer');
  await front.getByRole('button',{name:'置顶对话',exact:true}).click();
  await assertNoDialog(front);
  assert.ok((await fixture.db.conversation.findUniqueOrThrow({where:{id:ids.conversationId}})).pinnedAt);
  await openMenu(front,'聊天');
  await front.getByRole('button',{name:'取消置顶',exact:true}).click();
  await assertNoDialog(front);
  assert.equal((await fixture.db.conversation.findUniqueOrThrow({where:{id:ids.conversationId}})).pinnedAt,null);
  await openMenu(front,'聊天');
  await front.getByRole('button',{name:'重命名对话',exact:true}).click();
  await front.getByRole('textbox',{name:'对话名称',exact:true}).fill('抽屉操作验证');
  await front.getByRole('button',{name:'保存名称',exact:true}).click();
  await assertNoDialog(front);
  assert.equal((await fixture.db.conversation.findUniqueOrThrow({where:{id:ids.conversationId}})).title,'抽屉操作验证');
  await openMenu(front,'设置');
  await capture(front,'00b-mobile-settings-drawer');
  await front.keyboard.press('Escape');await assertNoDialog(front);
  assert.equal(await front.getByRole('button',{name:'更多对话操作',exact:true}).evaluate(element=>document.activeElement===element),true);
  checks.push('top-right half drawer switches categories, restores focus, and actually renames/pins/unpins through existing APIs');
  phase='mobile chat response option consumption';
  await front.goto(chatUrl,{waitUntil:'domcontentloaded'});
  await front.getByRole('textbox',{name:'消息内容',exact:true}).waitFor();
  await openMenu(front,'设置');
  await front.getByRole('button',{name:'回复方式',exact:true}).click();
  let settings=front.getByRole('dialog',{name:'回复方式',exact:true});
  await settings.getByRole('combobox',{name:'回复风格',exact:true}).selectOption('browser-natural');
  const contextWrite=front.waitForResponse(r=>r.url().endsWith('/context')&&r.request().method()==='PATCH');
  await settings.getByRole('button',{name:'保存对话设置',exact:true}).click();
  assert.equal((await contextWrite).status(),200);
  assert.equal((await fixture.db.conversation.findUniqueOrThrow({where:{id:ids.conversationId}})).responseStyle,'browser-natural');
  const contextRead=await userApi(front,'/api/conversations/'+ids.conversationId+'/context');
  assert.equal(contextRead.status,200);
  assert.ok(contextRead.body.styles.some(style=>style.key==='browser-natural'&&style.label==='专项自然风格'));
  await front.keyboard.press('Escape');await assertNoDialog(front);
  await front.reload({waitUntil:'domcontentloaded'});
  await openMenu(front,'设置');
  settings=front.getByRole('dialog',{name:'聊天与设置',exact:true});
  await capture(front,'04-mobile-chat-settings');
  await settings.getByRole('button',{name:'回复方式',exact:true}).click();
  settings=front.getByRole('dialog',{name:'回复方式',exact:true});
  await settings.getByRole('combobox',{name:'回复风格',exact:true}).waitFor();
  assert.equal(await settings.getByRole('combobox',{name:'回复风格',exact:true}).inputValue(),'browser-natural');
  await capture(front,'04b-mobile-response-settings');
  await front.getByRole('button',{name:'返回对话设置',exact:true}).click();
  checks.push('frontend reads admin-defined response style, saves conversation selection and preserves it after refresh');

  phase='mobile memory slow-read timeout and retry';
  const memoryPath='/api/conversations/'+ids.conversationId+'/memory';
  let forceSlowMemory=true;
  await context.route('**'+memoryPath,async route=>{
    if(forceSlowMemory&&route.request().method()==='GET'){
      await new Promise(resolve=>setTimeout(resolve,18000));
      return route.abort().catch(()=>{});
    }
    return route.continue();
  });
  const started=Date.now();
  await front.getByRole('button',{name:'角色记忆',exact:true}).click();
  let memory=front.getByRole('dialog',{name:'角色记忆',exact:true});
  await memory.getByText('正在读取记忆…',{exact:true}).waitFor();
  await memory.getByText('记忆读取超时，请重新加载。',{exact:true}).waitFor({timeout:22000});
  assert.ok(Date.now()-started>=14000,'memory must use its actual 15s timeout');
  await capture(front,'05-mobile-memory-timeout');
  forceSlowMemory=false;
  const memoryRetry=front.waitForResponse(r=>new URL(r.url()).pathname===memoryPath&&r.request().method()==='GET');
  await memory.getByRole('button',{name:'重新加载',exact:true}).click();
  const loaded=await memoryRetry;assert.equal(loaded.status(),200);
  const loadedBody=await loaded.json();assert.equal(loadedBody.enabled,true);
  await memory.getByRole('heading',{name:'对话摘要',exact:true}).waitFor();
  await memory.getByText('专项测试初始摘要：约好下次聊海边。',{exact:true}).waitFor();
  await memory.getByRole('heading',{name:'引用来源',exact:true}).waitFor();
  await memory.getByRole('link',{name:'查看摘要覆盖到的消息',exact:true}).waitFor();
  await capture(front,'06-mobile-memory-loaded');
  checks.push('memory waits 15s, displays a real retry state, then reads enabled policy and actual stored summary/source');

  phase='manual memory creation';
  await memory.getByRole('button',{name:'添加记忆',exact:true}).click();
  await memory.getByRole('textbox',{name:'新记忆内容',exact:true}).fill('专项手工记忆：喜欢清晨散步。');
  const memoryCreate=front.waitForResponse(r=>new URL(r.url()).pathname===memoryPath&&r.request().method()==='POST');
  await memory.getByRole('button',{name:'保存记忆',exact:true}).click();
  assert.equal((await memoryCreate).status(),200);
  await memory.getByText('专项手工记忆：喜欢清晨散步。',{exact:true}).waitFor();
  const createdFact=await fixture.db.memoryFact.findFirstOrThrow({where:{conversationId:ids.conversationId,userId:fixture.user.id,text:'专项手工记忆：喜欢清晨散步。'}});
  assert.equal(createdFact.status,'ACTIVE');
  checks.push('manual memory is really inserted as an owned ACTIVE fact');

  phase='summary edit CAS conflict and retry';
  await memory.getByRole('button',{name:'修正摘要',exact:true}).click();
  await memory.getByRole('textbox',{name:'修改对话摘要',exact:true}).fill('专项修正摘要：下一次聊清晨的海边。');
  const staleVersion=(await fixture.db.conversationMemory.findUniqueOrThrow({where:{conversationId:ids.conversationId}})).version;
  await fixture.db.conversationMemory.update({where:{conversationId:ids.conversationId},data:{summary:'并发测试摘要',version:{increment:1}}});
  const staleEdit=front.waitForResponse(r=>new URL(r.url()).pathname===memoryPath&&r.request().method()==='PATCH');
  await memory.getByRole('button',{name:'保存摘要',exact:true}).click();
  const staleResponse=await staleEdit;assert.equal(staleResponse.status(),409);
  assert.equal(staleResponse.request().postDataJSON().expectedVersion,staleVersion);
  assert.equal(await memory.getByRole('textbox',{name:'修改对话摘要',exact:true}).inputValue(),'专项修正摘要：下一次聊清晨的海边。','CAS conflict retains the actual user draft');
  await capture(front,'07-mobile-summary-conflict');
  await memory.getByRole('button',{name:'取消',exact:true}).click();
  await front.getByRole('button',{name:'返回对话设置',exact:true}).click();
  await front.getByRole('button',{name:'角色记忆',exact:true}).click();
  memory=front.getByRole('dialog',{name:'角色记忆',exact:true});
  await memory.getByText('并发测试摘要',{exact:true}).waitFor();
  await memory.getByRole('button',{name:'修正摘要',exact:true}).click();
  await memory.getByRole('textbox',{name:'修改对话摘要',exact:true}).fill('专项修正摘要：下一次聊清晨的海边。');
  const editSummary=front.waitForResponse(r=>new URL(r.url()).pathname===memoryPath&&r.request().method()==='PATCH');
  await memory.getByRole('button',{name:'保存摘要',exact:true}).click();
  assert.equal((await editSummary).status(),200);
  await memory.getByText('专项修正摘要：下一次聊清晨的海边。',{exact:true}).waitFor();
  const editedSummary=await fixture.db.conversationMemory.findUniqueOrThrow({where:{conversationId:ids.conversationId}});
  assert.equal(editedSummary.summary,'专项修正摘要：下一次聊清晨的海边。');
  assert.ok(editedSummary.version>staleVersion);
  assert.equal((await userApi(front,memoryPath,'DELETE',{expectedVersion:staleVersion})).status,409,'stale deletion cannot remove a newer summary');
  assert.equal((await fixture.db.conversationMemory.findUniqueOrThrow({where:{conversationId:ids.conversationId}})).version,editedSummary.version);
  await capture(front,'08-mobile-summary-edited');
  front.once('dialog',dialog=>void dialog.accept());
  const deleteSummary=front.waitForResponse(r=>new URL(r.url()).pathname===memoryPath&&r.request().method()==='DELETE');
  await memory.getByRole('button',{name:'删除摘要',exact:true}).click();
  const deleted=await deleteSummary;assert.equal(deleted.status(),200);
  assert.equal(deleted.request().postDataJSON().expectedVersion,editedSummary.version);
  await memory.getByText('还没有对话摘要。',{exact:true}).waitFor();
  assert.equal(await fixture.db.conversationMemory.findUnique({where:{conversationId:ids.conversationId}}),null);
  assert.equal((await fixture.db.memoryFact.findUniqueOrThrow({where:{id:createdFact.id}})).status,'ACTIVE');
  await capture(front,'09-mobile-summary-deleted');
  checks.push('summary edit and delete use real version CAS; conflicts retain input and confirmed facts survive summary deletion');
  await front.keyboard.press('Escape');await assertNoDialog(front);

  }
  phase='story settings persist and bind to run';
  await front.goto(origin+'/chat?storyRun='+encodeURIComponent(ids.storyRunId),{waitUntil:'domcontentloaded'});
  await openMenu(front,'设置');
  await front.getByRole('button',{name:'场景设置',exact:true}).click();
  let scene=front.getByRole('dialog',{name:'故事场景设置',exact:true});
  await scene.getByRole('textbox',{name:'我在故事中的身份',exact:true}).waitFor();
  await scene.getByRole('textbox',{name:'我在故事中的身份',exact:true}).fill('专项身份：刚下末班车的旅人');
  await scene.getByRole('textbox',{name:'本次章节目标',exact:true}).fill('专项目标：寻找那封旧信');
  await scene.getByRole('textbox',{name:'场景补充',exact:true}).fill('专项场景：雨后车站，避免血腥描写');
  await scene.getByRole('combobox',{name:'故事叙事方式',exact:true}).selectOption('browser-cinematic');
  const storySettingsPath='/api/story-runs/'+ids.storyRunId+'/settings';
  const storyWrite=front.waitForResponse(r=>new URL(r.url()).pathname===storySettingsPath&&r.request().method()==='PUT');
  await scene.getByRole('button',{name:'保存场景设定',exact:true}).click();
  const written=await storyWrite;assert.equal(written.status(),200);
  const writeBody=written.request().postDataJSON();assert.ok(Number.isInteger(writeBody.expectedRevision));
  await scene.getByText('已保存，下一回合和行动建议会使用这些设定。',{exact:true}).waitFor();
  const storedRun=await fixture.db.storyRun.findUniqueOrThrow({where:{id:ids.storyRunId}});
  const parsedSettings=JSON.parse(storedRun.settingsJson);
  assert.equal(parsedSettings.playerIdentity,'专项身份：刚下末班车的旅人');
  assert.equal(parsedSettings.chapterGoal,'专项目标：寻找那封旧信');
  assert.equal(parsedSettings.narrativeStyle,'browser-cinematic');
  assert.ok(storedRun.revision>writeBody.expectedRevision);
  await capture(front,'10-mobile-story-settings');
  await front.keyboard.press('Escape');await assertNoDialog(front);
  await front.reload({waitUntil:'domcontentloaded'});
  await openMenu(front,'设置');
  await front.getByRole('button',{name:'场景设置',exact:true}).click();
  scene=front.getByRole('dialog',{name:'故事场景设置',exact:true});
  await scene.getByRole('textbox',{name:'我在故事中的身份',exact:true}).waitFor();
  assert.equal(await scene.getByRole('textbox',{name:'我在故事中的身份',exact:true}).inputValue(),parsedSettings.playerIdentity);
  assert.equal(await scene.getByRole('textbox',{name:'本次章节目标',exact:true}).inputValue(),parsedSettings.chapterGoal);
  assert.equal(await scene.getByRole('textbox',{name:'场景补充',exact:true}).inputValue(),parsedSettings.sceneSupplement);
  assert.equal(await scene.getByRole('combobox',{name:'故事叙事方式',exact:true}).inputValue(),'browser-cinematic');
  const runRead=await userApi(front,'/api/story-runs/'+ids.storyRunId);
  assert.equal(runRead.status,200);
  assert.equal(runRead.body.settings?.playerIdentity??runRead.body.run?.settings?.playerIdentity,parsedSettings.playerIdentity);
  const originalConversation=await fixture.db.conversation.findUniqueOrThrow({where:{id:storedRun.conversationId}});
  const otherConversation=await fixture.db.conversation.create({data:{userId:fixture.user.id,characterId:originalConversation.characterId,title:'专项第二个故事'}});
  const otherRun=await fixture.db.storyRun.create({data:{userId:fixture.user.id,conversationId:otherConversation.id,templateVersionId:storedRun.templateVersionId,chapterKey:storedRun.chapterKey,stateJson:storedRun.stateJson,createRequestId:'chat-settings-other-run',startedAt:new Date()}});
  const otherSettings=await userApi(front,'/api/story-runs/'+otherRun.id+'/settings');
  assert.equal(otherSettings.status,200);
  assert.equal(otherSettings.body.settings.playerIdentity,'');
  assert.equal(otherSettings.body.settings.chapterGoal,'');
  assert.equal(otherSettings.body.settings.sceneSupplement,'');
  assert.equal(otherSettings.body.settings.narrativeStyle,'');
  await capture(front,'11-mobile-story-settings-refreshed');
  checks.push('story admin narrative option reaches actual run settings, revision save persists after refresh and another run remains separate');

  phase='story failed state retry from drawer';
  await front.keyboard.press('Escape');await assertNoDialog(front);
  const pendingRun=await fixture.db.storyRun.findUniqueOrThrow({where:{id:ids.storyRunId}});
  const maxTurn=await fixture.db.storyTurn.aggregate({where:{runId:ids.storyRunId},_max:{turnNo:true}});
  const turnNo=(maxTurn._max.turnNo??0)+1;
  const inputMessage=await fixture.db.message.create({data:{conversationId:pendingRun.conversationId,role:'USER',content:'测试：回到车站。'}});
  const outputMessage=await fixture.db.message.create({data:{conversationId:pendingRun.conversationId,role:'ASSISTANT',content:'测试：角色站在站台等你。'}});
  const failedTurn=await fixture.db.storyTurn.create({data:{runId:ids.storyRunId,turnNo,requestId:'drawer-state-retry',requestHash:'drawer-state-retry',status:'COMMITTED',stateStatus:'FAILED',operation:'CHAT',inputMessageId:inputMessage.id,assistantMessageId:outputMessage.id,startedAt:new Date(),committedAt:new Date()}});
  await fixture.db.storyRun.update({where:{id:ids.storyRunId},data:{lastCommittedTurnNo:turnNo}});
  const messageCount=await fixture.db.message.count({where:{conversationId:pendingRun.conversationId}});
  await front.reload({waitUntil:'domcontentloaded'});
  await openMenu(front,'聊天');
  await front.getByRole('button',{name:'重试整理 第'+turnNo+'回合',exact:true}).waitFor();
  assert.equal(await front.getByRole('button',{name:'结束本章',exact:true}).isDisabled(),true);
  await capture(front,'12-story-retry-drawer');
  const retryResult=front.waitForResponse(r=>r.url().endsWith('/retry-state')&&r.request().method()==='POST');
  await front.getByRole('button',{name:'重试整理 第'+turnNo+'回合',exact:true}).click();
  assert.equal((await retryResult).status(),200);
  await front.getByText('等待后台整理；长时间未变化时可重新提交。',{exact:true}).waitFor();
  assert.equal((await fixture.db.storyTurn.findUniqueOrThrow({where:{id:failedTurn.id}})).stateStatus,'PENDING');
  assert.equal(await fixture.db.message.count({where:{conversationId:pendingRun.conversationId}}),messageCount);
  // Fixture represents the worker's successful completion; the actual worker is separately covered by the D31 integration test.
  await fixture.db.storyTurn.update({where:{id:failedTurn.id},data:{stateStatus:'PROCESSED'}});
  await fixture.db.storyRun.update({where:{id:ids.storyRunId},data:{stateProcessedThroughTurnNo:turnNo,revision:{increment:1}}});
  await front.getByRole('button',{name:'刷新整理状态',exact:true}).click();
  await front.getByText('已保存回合的状态整理完成。',{exact:true}).waitFor();
  assert.equal(await front.getByRole('button',{name:'结束本章',exact:true}).isEnabled(),true);
  await capture(front,'13-story-recovered-drawer');
  await front.getByText('存档与分支',{exact:true}).click();
  await front.getByRole('textbox',{name:'存档名称',exact:true}).fill('切换标签保留的名称');
  await front.getByRole('tab',{name:'设置',exact:true}).click();
  await front.getByRole('tab',{name:'聊天',exact:true}).click();
  assert.equal(await front.getByRole('textbox',{name:'存档名称',exact:true}).inputValue(),'切换标签保留的名称');
  checks.push('failed story state really retries to PENDING without resending messages; refreshed completion unlocks chapter actions');

  phase='guarded services remain closed';
  const checkout=await front.request.get(origin+'/api/coins/packages');
  assert.equal(checkout.headers()['x-checkout-enabled'],'false');
  assert.equal(await fixture.db.aiCall.count(),0,'these browser workflows must not invoke AI');
  assert.deepEqual(blockedRequests,[]);
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
