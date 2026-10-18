import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const base = process.env.TEST_BASE_URL;
assert(base && ['127.0.0.1', 'localhost'].includes(new URL(base).hostname), '须指定本机隔离服务');
assert.equal(process.env.TEST_ISOLATED_DB, 'true', '会注销本脚本创建的账号，须使用隔离数据库');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12), password = `LocalOnly!${randomUUID()}`;
  const email = `closure-${suffix}@example.invalid`;
  const registered = await page.request.post(`${base}/api/auth/register`, { data: { username: `closure_${suffix}`, email, password } });
  assert.equal(registered.status(), 201);
  const { token, user } = await registered.json();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  const uploaded = await page.request.post(`${base}/api/upload`, { headers: { Authorization: `Bearer ${token}` }, multipart: { file: { name: 'pixel.png', mimeType: 'image/png', buffer: png } } });
  assert.equal(uploaded.status(), 200, await uploaded.text());
  const { url } = await uploaded.json();
  const image = await page.request.get(base + url);
  assert.equal(image.status(), 200, 'new uploads must be served by the running production instance');
  assert.equal(image.headers()['x-content-type-options'], 'nosniff');
  assert((await page.context().cookies(base)).find(cookie => cookie.name === 'xingban_media_session')?.httpOnly);
  const anonymous = await browser.newContext();
  try {
    assert.equal((await anonymous.request.get(base + url)).status(), 404, 'private new upload must reject anonymous access');
  } finally { await anonymous.close(); }
  const optimized = await page.request.get(`${base}/_next/image?url=${encodeURIComponent(url)}&w=64&q=75`);
  assert.equal(optimized.status(), 400);
  assert.match(await optimized.text(), /url.*not allowed/i, 'private media must be excluded from the public optimizer');
  await page.goto(`${base}/login`);
  // An older startup request must not overwrite a newly authenticated session.
  const older = await page.request.post(`${base}/api/auth/register`, { data: { username: `older_${suffix}`, email: `older-${suffix}@example.invalid`, password } });
  assert.equal(older.status(), 201);
  const oldSession = await older.json();
  let releaseOld, markStarted, markFinished;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  const started = new Promise(resolve => { markStarted = resolve; });
  const finished = new Promise(resolve => { markFinished = resolve; });
  await page.route('**/api/auth/me', async route => {
    if (route.request().headers().authorization !== `Bearer ${oldSession.token}`) return route.continue();
    markStarted(); await oldGate;
    await route.fulfill({ json: { user: oldSession.user } }); markFinished();
  });
  await page.evaluate(value => localStorage.setItem('xingban_token', value), oldSession.token);
  await page.reload(); await started;
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL('**/discover');
  releaseOld(); await finished;
  await page.locator('a[href="/profile"]:visible').last().click();
  await page.getByRole('heading', { name: user.username, exact: true }).waitFor();
  assert.notEqual(await page.evaluate(() => localStorage.getItem('xingban_token')), oldSession.token);
  await page.unroute('**/api/auth/me');
  await page.getByText('注销账号', { exact: true }).click();
  const button = page.getByRole('button', { name: '确认注销账号', exact: true });
  assert(await button.isDisabled());
  await page.getByLabel('当前密码', { exact: true }).fill('wrong');
  await page.getByLabel('输入“注销我的账号”', { exact: true }).fill('注销我的账号');
  await page.getByRole('checkbox', { name: /我已了解删除范围/ }).check();
  await button.click();
  await page.getByRole('alert').filter({ hasText: '密码不正确' }).waitFor();
  assert.equal((await page.request.get(`${base}/api/users/me`, { headers: { Authorization: `Bearer ${token}` } })).status(), 200);
  await page.getByLabel('当前密码', { exact: true }).fill(password);
  const closeResponse = page.waitForResponse(response => response.url().endsWith('/api/users/me/close') && response.request().method() === 'POST');
  await button.click();
  assert.equal((await closeResponse).status(), 200);
  await page.getByRole('status').filter({ hasText: '账号已注销' }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('xingban_token')), null);
  assert.equal((await page.request.get(`${base}/api/users/me`, { headers: { Authorization: `Bearer ${token}` } })).status(), 401);
  assert.equal((await page.request.post(`${base}/api/auth/login`, { data: { email, password } })).status(), 401);
  assert.equal((await page.request.get(base + url)).status(), 404);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  console.log('PASS 真实上传/生产图片读取、旧会话延迟响应隔离、注销确认/错误密码/注销成功、凭据失效、文件删除、390px 布局（仅本地合成账号）');
} finally { await browser.close(); }
