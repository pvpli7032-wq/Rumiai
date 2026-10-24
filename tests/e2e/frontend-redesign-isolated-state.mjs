import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer, request as proxyRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createFixture } from '../helpers/sqlite-fixture.mjs';
import { seedFrontendRouteData } from '../helpers/frontend-redesign-route-fixture.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/www/wwwroot/khui-ai/shared/playwright-browsers';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

// The server image provides this verified Chromium binary; an explicit override
// keeps the harness portable without triggering a Playwright browser download.
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/usr/lib64/chromium-browser/headless_shell';
const root = fileURLToPath(new URL('../..', import.meta.url));
const apiRoot = process.env.FRONTEND_REDESIGN_API_RELEASE || root;
const webDistDir = process.env.FRONTEND_REDESIGN_WEB_DIST_DIR || '.next-build';
const apiDistDir = process.env.FRONTEND_REDESIGN_API_DIST_DIR || '.next-api';
const webPort = Number(process.env.FRONTEND_REDESIGN_WEB_PORT || 3310);
const candidateWebPort = Number(process.env.FRONTEND_REDESIGN_CANDIDATE_WEB_PORT || 3314);
const apiPort = Number(process.env.FRONTEND_REDESIGN_API_PORT || 3312);
const webOrigin = 'http://127.0.0.1:' + webPort;
const apiOrigin = 'http://127.0.0.1:' + apiPort;
const artifacts = path.resolve(process.env.FRONTEND_REDESIGN_ARTIFACTS || path.join(root, 'artifacts', 'frontend'));
const runId = process.env.FRONTEND_REDESIGN_RUN_ID || 'unspecified';
const requiredBuilds = [
  path.join(root, 'apps', 'web', webDistDir),
  path.join(apiRoot, 'apps', 'api', apiDistDir),
];

if (process.env.DATABASE_URL) {
  throw new Error('frontend-redesign fixture refuses an external DATABASE_URL');
}

if (requiredBuilds.some(build => !existsSync(path.join(build, 'BUILD_ID')))) {
  throw new Error('Build the web and API applications before running test:e2e:frontend');
}

mkdirSync(artifacts, { recursive: true });
writeFileSync(path.join(artifacts, 'state-harness-start.json'), JSON.stringify({runId, startedAt: new Date().toISOString(), matrixSkipped: process.env.FRONTEND_REDESIGN_SKIP_MATRIX === '1'}, null, 2));

const children = [];
const proxyServers = [];
function startFixtureProxy() { const server=createServer((req,res)=>{ const target=(req.url||'').startsWith('/api/') ? apiOrigin : 'http://127.0.0.1:'+candidateWebPort; const upstream=proxyRequest(target+(req.url||'/'),{method:req.method,headers:{...req.headers,host:new URL(target).host}},reply=>{res.writeHead(reply.statusCode||502,reply.headers);reply.pipe(res);}); upstream.on('error',()=>{res.writeHead(502);res.end('fixture proxy upstream error');}); req.pipe(upstream); }); server.listen(webPort,'127.0.0.1'); proxyServers.push(server); }
let fixture;
let browser;
let context;
const dialogs = [];
const externalRequests = [];
const apiResponses = [];
let phase = 'bootstrap';

function start(app, port, env, runtimeRoot) {
  const child = spawn(process.execPath, [
    path.join(runtimeRoot, 'node_modules', 'next', 'dist', 'bin', 'next'),
    'start',
    '-p',
    String(port),
  ], {
    cwd: path.join(runtimeRoot, 'apps', app),
    env,
    ...(app === 'web' ? {uid: 1000, gid: 1000} : {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const record = { child, output: '' };
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', data => { record.output += data.toString(); });
  }
  children.push(record);
}

async function stopChildren() {
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  await Promise.all(proxyServers.map(server => new Promise(resolve => server.close(resolve))));
  await Promise.all(children.map(({ child }) => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      resolve();
    }, 8000);
    child.once('close', () => { clearTimeout(timer); resolve(); });
  })));
}

async function waitForService(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const failed = children.find(({ child }) => child.exitCode !== null || child.signalCode !== null);
    if (failed) throw new Error('isolated service exited before readiness: ' + failed.output);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status < 500) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('isolated service not ready: ' + url + '\n' + children.map(item => item.output).join('\n'));
}

async function runBrowserMatrix(manifestPath) {
  const reportPath = path.join(artifacts, 'browser-matrix.log');
  const child = spawn(process.execPath, [path.join(root, 'tests', 'e2e', 'frontend-redesign-browser.mjs')], {cwd: root, env: {...process.env, FRONTEND_REDESIGN_MODE: 'matrix', FRONTEND_REDESIGN_FIXTURE_MANIFEST: manifestPath, FRONTEND_REDESIGN_BASE_URL: webOrigin, FRONTEND_REDESIGN_OUTPUT_DIR: path.join(artifacts, 'browser-matrix')}, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  child.stdout.on('data', value => { output += value.toString(); }); child.stderr.on('data', value => { output += value.toString(); });
  await new Promise((resolve, reject) => child.once('close', code => { writeFileSync(reportPath, output); code === 0 ? resolve() : reject(new Error(output)); }));
}

async function runDomain(name, manifestPath) {
  const outputDir = path.join(artifacts, 'domains', name);
  mkdirSync(outputDir, {recursive: true});
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'tests', 'e2e', 'frontend-redesign-' + name + '.mjs')], {cwd: root, env: {...process.env, FRONTEND_REDESIGN_FIXTURE_MANIFEST: manifestPath, FRONTEND_REDESIGN_BASE_URL: webOrigin, FRONTEND_REDESIGN_OUTPUT_DIR: outputDir, PLAYWRIGHT_CHROMIUM_EXECUTABLE: chromiumExecutablePath}, stdio: ['ignore', 'pipe', 'pipe']});
  let output = ''; child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
  const code = await new Promise(resolve => child.once('close', resolve));
  writeFileSync(path.join(outputDir, 'runner.log'), output);
  return {name, status: code === 0 ? 'PASS' : 'FAIL', exitCode: code, outputDir};
}

async function waitFor(predicate, label, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('timed out waiting for ' + label);
}

async function numericText(locator) {
  const value = String(await locator.textContent());
  const match = value.match(/金币\s*([0-9,]+)/);
  const amount = Number((match?.[1] ?? '').replaceAll(',', ''));
  assert.ok(Number.isFinite(amount), 'expected a finite coin balance, received: ' + value);
  return amount;
}

try {
  fixture = await createFixture();

  const routeData = await seedFrontendRouteData(fixture);
  writeFileSync(path.join(artifacts, 'fixture-manifest.json'), JSON.stringify({
    synthetic: true,
    locale: routeData.locale,
    login: {email: fixture.user.email, password: fixture.password},
    ids: routeData,
    webBaseUrl: webOrigin,
    apiBaseUrl: apiOrigin,
    expected: {characterTitle: 'E2E 路由角色', conversationTitle: 'E2E 路由角色', shareChatTitle: 'E2E 已登录对话', storyTitle: 'E2E 路由故事', circleName: 'E2E 路由圈子', disputeTitle: 'E2E 合成评理主张', mirrorTitle: 'E2E 他眼中的你', cmsTitle: 'E2E CMS 页面', creatorName: 'E2E 用户', creatorDraftTitle: 'E2E 路由角色', postTitle: 'E2E 合成广场帖子。', fixtureUserName: 'E2E 用户'},
  }, null, 2));
  await fixture.db.growthModuleState.upsert({
    where: { moduleId: 'checkin' },
    create: { moduleId: 'checkin', isEnabled: true, configJson: '{}', version: 1, updatedBy: fixture.admin.id },
    update: { isEnabled: true },
  });
  await fixture.db.growthModuleState.upsert({
    where: { moduleId: 'missions' },
    create: { moduleId: 'missions', isEnabled: true, configJson: '{}', version: 1, updatedBy: fixture.admin.id },
    update: { isEnabled: true },
  });
  const mission = await fixture.db.mission.create({
    data: {
      title: 'E2E 签到任务',
      description: '隔离 fixture：完成一次签到后领取。',
      rewardCoins: 3,
      category: 'DAILY',
      conditionType: 'CHECKIN_COUNT',
      conditionTarget: 1,
      period: 'ONCE',
      isActive: true,
      sortOrder: 0,
    },
  });
  await fixture.disconnect();

  const env = {
    ...process.env,
    DATABASE_URL: 'file:' + fixture.dbPath.replaceAll('\\', '/'),
    UPLOADS_DIRECTORY: path.join(fixture.dir, 'uploads'),
    BACKUPS_DIRECTORY: path.join(fixture.dir, 'backups'),
    INTERNAL_API_ORIGIN: apiOrigin,
    ADMIN_API_INTERNAL_URL: apiOrigin,
    NEXT_PUBLIC_SITE_URL: webOrigin,
    WEB_PORT: String(candidateWebPort),
    API_PORT: String(apiPort),
    ADMIN_PORT: '3311',
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    JWT_SECRET: 'frontend-redesign-isolated-secret-012345678901234567890123',
    EZFP_ENABLED: 'false',
    EZFP_REFUNDS_ENABLED: 'false',
    EZFP_PID: '',
    EZFP_MERCHANT_PRIVATE_KEY: '',
    EZFP_PLATFORM_PUBLIC_KEY: '',
    AI_API_KEY: '',
    OPENAI_API_KEY: '',
    DISABLE_MOCK_AI: 'true',
    STORY_WORKER_DISABLED: '1',
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
  };

  const apiEnv = { ...env, NEXT_DIST_DIR: apiDistDir };
  const webEnv = { ...env, NEXT_DIST_DIR: webDistDir };
  start('api', apiPort, apiEnv, apiRoot);
  start('web', candidateWebPort, webEnv, root);
  startFixtureProxy();
  await waitForService(apiOrigin + '/api/memberships');
  await waitForService(webOrigin + '/login');
  const fixtureProbe = await (await fetch(webOrigin + '/api/public-character/' + encodeURIComponent(routeData.characterId))).text();
  if (!fixtureProbe.includes('E2E 路由角色')) throw new Error('3310 proxy did not reach the isolated fixture API');
  const sitemap = await (await fetch(webOrigin + '/sitemap.xml')).text();
  routeData.sitemapFile = sitemap.match(/sitemaps\/([^<"\s]+)/)?.[1] ?? null;
  if (!routeData.sitemapFile) throw new Error('isolated sitemap did not expose a shard for the route matrix');
  const manifestPath = path.join(artifacts, 'fixture-manifest.json');
  writeFileSync(manifestPath, JSON.stringify({synthetic: true, locale: routeData.locale, login: {email: fixture.user.email, password: fixture.password}, ids: routeData, webBaseUrl: webOrigin, apiBaseUrl: apiOrigin, expected: {characterTitle: 'E2E 路由角色', conversationTitle: 'E2E 路由角色', shareChatTitle: 'E2E 已登录对话', storyTitle: 'E2E 路由故事', circleName: 'E2E 路由圈子', disputeTitle: 'E2E 合成评理主张', mirrorTitle: 'E2E 他眼中的你', cmsTitle: 'E2E CMS 页面', creatorName: 'E2E 用户', creatorDraftTitle: 'E2E 路由角色', postTitle: 'E2E 合成广场帖子。', fixtureUserName: 'E2E 用户'}}, null, 2));
  // Matrix runs only after the independent state assertions below.

  browser = await chromium.launch({
    executablePath: chromiumExecutablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const allowedOrigins = new Set([webOrigin, apiOrigin]);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !allowedOrigins.has(url.origin)) {
      externalRequests.push(route.request().url());
      await route.abort();
      return;
    }
    await route.continue();
  });
  const page = await context.newPage();
  page.on('dialog', async dialog => {
    dialogs.push(dialog.message());
    await dialog.accept();
  });
  page.on('response', response => {
    if (response.url().includes('/api/checkin')) apiResponses.push({endpoint: response.request().method() + ' ' + new URL(response.url()).pathname, status: response.status(), authorizationPresent: Boolean(response.request().headers().authorization)});
  });

  await page.goto(webOrigin + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('邮箱').fill(fixture.user.email);
  await page.locator('input[type="password"]').fill(fixture.password);
  const [loginResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST'),
    page.getByRole('button', { name: '登录', exact: true }).click(),
  ]);
  if (!loginResponse.ok()) throw new Error('fixture login failed: ' + loginResponse.status() + ' ' + await loginResponse.text());
  await page.waitForURL(url => !url.pathname.endsWith('/login'), {timeout: 10000});
  await page.goto(webOrigin + '/profile', { waitUntil: 'domcontentloaded' });
  try { await page.getByRole('heading', { name: '每日签到', exact: true }).waitFor({timeout: 5000}); } catch (error) {
    writeFileSync(path.join(artifacts, 'state-result.json'), JSON.stringify({status: 'FAIL', error: 'profile check-in UI unavailable', url: page.url(), body: await page.locator('body').innerText(), storage: await page.evaluate(() => ({local: Object.keys(localStorage), session: Object.keys(sessionStorage)}))}, null, 2));
    await page.screenshot({path: path.join(artifacts, 'profile-state-failure.png'), fullPage: true}); throw error;
  }

  const profileCoins = page.getByRole('link', {name: /账户与资产/}).getByText(/^金币\s/);
  const initialCoins = await numericText(profileCoins);
  const checkinRequests = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/api/checkin')) checkinRequests.push(request);
  });

  const checkinButton = page.getByRole('button', { name: /签到/ }).filter({ hasNotText: '今日已签到' });
  await checkinButton.waitFor({ state: 'visible' });
  phase = 'checkin';
  const checkinResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/checkin'));
  await checkinButton.evaluate(button => { button.click(); button.click(); });
  const response = await checkinResponse;
  apiResponses.push({endpoint: 'POST /api/checkin', status: response.status(), body: await response.text().catch(() => '')});
  await waitFor(async () => await page.getByRole('button', { name: /今日已签到|✅ 今日已签到/ }).count() === 1, 'checked-in UI');
  assert.equal(checkinRequests.length, 1, 'check-in double click must produce one POST');
  const afterCheckinCoins = await numericText(profileCoins);
  assert.ok(afterCheckinCoins > initialCoins, 'refreshUser must update profile coins after check-in');

  const missionButton = page.getByRole('button', { name: '领取', exact: true });
  await missionButton.waitFor({ state: 'visible' });
  const missionRequests = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/api/missions/' + mission.id + '/complete')) missionRequests.push(request);
  });
  await missionButton.evaluate(button => { button.click(); button.click(); });
  await waitFor(() => missionRequests.length > 0, 'mission claim request');
  await waitFor(async () => await page.getByRole('button', { name: '领取', exact: true }).count() === 0, 'completed mission UI');
  assert.equal(missionRequests.length, 1, 'mission double click must produce one POST');
  const afterMissionCoins = await numericText(profileCoins);
  assert.ok(afterMissionCoins > afterCheckinCoins, 'refreshUser must update profile coins after mission claim');

  phase = 'ledger';
  await page.goto(webOrigin + '/shop/ledger', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '金币流水', exact: true }).waitFor();
  const ledgerRows = page.locator('ul.divide-y > li');
  await ledgerRows.filter({hasText: /金币获得.*每日签到|每日签到.*金币获得/}).first().waitFor();
  await ledgerRows.filter({hasText: /金币获得.*任务奖励|任务奖励.*金币获得/}).first().waitFor();

  assert.equal(externalRequests.length, 0, 'isolated browser made external HTTP requests: ' + externalRequests.join(', '));
  writeFileSync(path.join(artifacts, 'state-result.json'), JSON.stringify({status: 'PASS', checkinPosts: checkinRequests.length, missionPosts: missionRequests.length, initialCoins, afterCheckinCoins, afterMissionCoins, ledgerLabels: ['每日签到', '任务奖励']}, null, 2));
  const evidence = {state: {checkinPosts: checkinRequests.length, missionPosts: missionRequests.length, initialCoins, afterCheckinCoins, afterMissionCoins}, matrix: null, domains: []};
  if (process.env.FRONTEND_REDESIGN_SKIP_MATRIX !== '1') { try { await runBrowserMatrix(manifestPath); evidence.matrix = 'PASS'; } catch (error) { evidence.matrix = {status: 'FAIL', error: error instanceof Error ? error.message : String(error)}; } }
  for (const domain of ['discovery', 'chat', 'commerce', 'community', 'account']) evidence.domains.push(await runDomain(domain, manifestPath));
  writeFileSync(path.join(artifacts, 'aggregate.json'), JSON.stringify(evidence, null, 2));
  assert.ok(evidence.matrix !== 'FAIL' && evidence.matrix?.status !== 'FAIL' && !evidence.domains.some(item => item.status === 'FAIL'), 'one or more matrix/domain checks failed');
  console.log(JSON.stringify({
    status: 'PASS',
    isolatedDatabase: fixture.dbPath,
    webOrigin,
    apiOrigin,
    apiRelease: apiRoot,
    webDistDir,
    apiDistDir,
    missionId: mission.id,
    checkinPosts: checkinRequests.length,
    missionPosts: missionRequests.length,
    initialCoins,
    afterCheckinCoins,
    afterMissionCoins,
    ledgerLabels: ['每日签到', '任务奖励'],
    dialogs,
    externalRequests,
    payment: { checkout: false, refunds: false, aiFees: false },
  }));
} catch (error) {
  writeFileSync(path.join(artifacts, 'state-result.json'), JSON.stringify({status: 'FAIL', runId, phase, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : null, apiResponses}, null, 2));
  throw error;
} finally {
  await context?.close();
  await browser?.close();
  await stopChildren();
  await fixture?.cleanup();
}
