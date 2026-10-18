import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.TEST_BASE_URL;
assert(base && ['127.0.0.1', 'localhost'].includes(new URL(base).hostname), '须指定本机隔离服务');
assert.equal(process.env.TEST_ISOLATED_DB, 'true', '本脚本会创建安全验收数据，须使用隔离数据库');
const output = 'artifacts/security-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const checks = [], errors = [];
const pass = message => { checks.push(message); console.log('PASS', message); };
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = `LocalOnly!${randomUUID()}`;
  const register = async name => {
    const email = `${name}-${suffix}@example.invalid`;
    const response = await context.request.post(`${base}/api/auth/register`, { data: { username: `${name}_${suffix}`, email, password } });
    assert.equal(response.status(), 201, await response.text());
    return { ...(await response.json()), email };
  };
  const owner = await register('security_owner'), other = await register('security_other');
  const headers = { Authorization: `Bearer ${owner.token}` };
  for (const route of ['login', 'register']) {
    for (const data of ['{', 'null', '[]', JSON.stringify({ username: 'invalid_fixture', email: owner.email, password: {} })]) {
      const response = await context.request.post(`${base}/api/auth/${route}`, { headers: { 'Content-Type': 'application/json' }, data });
      assert.equal(response.status(), 400, `${route}: invalid body`);
    }
  }
  assert.equal((await context.request.post(`${base}/api/auth/login`, { data: { email: "' OR 1=1 --", password } })).status(), 401);
  const validLogin = await context.request.post(`${base}/api/auth/login`, { data: { email: owner.email, password } });
  assert.equal(validLogin.status(), 200);
  assert.equal((await validLogin.json()).user.id, owner.user.id);
  pass('认证无效 JSON/密码类型返回 400，SQL 字符串不能绕过登录，合法登录保持可用');

  const forged = `${owner.token.slice(0, owner.token.lastIndexOf('.') + 1)}invalid`;
  assert.equal((await context.request.get(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${forged}` } })).status(), 401);
  // The media cookie from login must never authenticate a mutating API.
  assert.equal((await context.request.post(`${base}/api/circles`, { data: { name: 'Cookie-only write', description: 'must reject without bearer token' } })).status(), 401);
  assert.equal((await context.request.get(`${base}/api/finance/report`, { headers })).status(), 403);
  pass('伪造 JWT、仅图片 Cookie 的写操作及普通账号财务访问被拒绝');

  const circleName = `安全验收-${suffix}`;
  const created = await context.request.post(`${base}/api/circles`, { headers, data: { name: circleName, description: 'Local security fixture only' } });
  assert.equal(created.status(), 201, await created.text());
  const circle = await created.json();
  assert.equal((await context.request.put(`${base}/api/circles/${circle.id}/subscription`, { headers })).status(), 200);
  const payload = `<img src=x onerror="window.__securityXss=true"><script>window.__securityXss=true</script> ${suffix}`;
  const posted = await context.request.post(`${base}/api/circles/${circle.id}/posts`, { headers, data: { content: payload } });
  assert.equal(posted.status(), 201, await posted.text());
  const { post } = await posted.json();
  assert.equal((await context.request.delete(`${base}/api/posts/${post.id}`, { headers: { Authorization: `Bearer ${other.token}` } })).status(), 403);
  const searched = await context.request.get(`${base}/api/circles?search=${encodeURIComponent("' OR 1=1 --")}`);
  assert.equal(searched.status(), 200);
  assert.deepEqual(await searched.json(), []);
  pass('SQL 搜索按普通文字处理，他人不能删除测试作者的帖子');

  await page.addInitScript(() => { window.__securityXss = false; });
  await page.goto(`${base}/login`);
  await page.evaluate(token => localStorage.setItem('khuiai_token', token), owner.token);
  await page.goto(`${base}/circles/${circle.id}`);
  await page.getByText(payload, { exact: true }).waitFor();
  assert.equal(await page.locator('img[src="x"], script').evaluateAll(elements => elements.some(element => element.textContent?.includes('window.__securityXss=true') || element.getAttribute('src') === 'x')), false);
  assert.equal(await page.evaluate(() => window.__securityXss), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${output}/escaped-post.png` });
  pass('持久化 HTML/脚本按文字显示，真实 Chromium 未执行注入代码且无页面错误');

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
  assert.equal((await context.request.post(`${base}/api/upload`, { headers, multipart: { file: { name: 'script.svg', mimeType: 'image/svg+xml', buffer: svg } } })).status(), 415);
  assert.equal((await context.request.post(`${base}/api/upload`, { headers, multipart: { file: { name: 'fake.png', mimeType: 'image/png', buffer: svg } } })).status(), 415);
  assert.equal((await context.request.delete(`${base}/api/posts/${post.id}`, { headers })).status(), 200);
  pass('SVG 和伪装 PNG 上传被拒绝；测试作者可删除本人的测试帖子');
} finally {
  await writeFile(`${output}/result.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
