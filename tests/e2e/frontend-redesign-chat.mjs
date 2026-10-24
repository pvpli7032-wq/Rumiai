import { strict as assert } from 'node:assert';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const manifestPath = process.env.FRONTEND_REDESIGN_FIXTURE_MANIFEST;
assert.ok(manifestPath, 'FRONTEND_REDESIGN_FIXTURE_MANIFEST is required');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert.equal(manifest.synthetic, true, 'chat E2E accepts only the isolated synthetic fixture');
const baseURL = process.env.FRONTEND_REDESIGN_BASE_URL || manifest.webBaseUrl || 'http://127.0.0.1:3310';
const outputDir = process.env.FRONTEND_REDESIGN_CHAT_OUTPUT_DIR || path.join(path.dirname(manifestPath), 'chat');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/lib64/chromium-browser/headless_shell';
await mkdir(outputDir, { recursive: true });

async function login(page) {
  await page.goto(baseURL + '/login', { waitUntil: 'networkidle' });
  await page.getByLabel('邮箱').fill(manifest.login.email);
  await page.locator('input[type="password"]').fill(manifest.login.password);
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST'),
    page.getByRole('button', { name: '登录', exact: true }).click(),
  ]);
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
}

const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await login(page);

  await page.goto(baseURL + '/chat', { waitUntil: 'networkidle' });
  await assert.doesNotReject(() => page.getByRole('heading', { name: '聊天', exact: true }).waitFor());
  await assert.doesNotReject(() => page.locator('input[aria-label="搜索对话"]:visible').waitFor());
  await assert.doesNotReject(() => page.getByText('常聊的角色', { exact: true }).waitFor());
  await assert.doesNotReject(() => page.getByText('最近对话', { exact: true }).waitFor());
  const search = page.locator('input[aria-label="搜索对话"]:visible');
  const inbox = search.locator('xpath=ancestor::section[1]');
  await search.fill('E2E 路由角色');
  const recentList = inbox.locator('ul').last();
  const conversationId = encodeURIComponent(manifest.ids.conversationId);
  const targetLink = recentList.locator(`a[href*="conversation=${conversationId}"]`);
  await assert.doesNotReject(() => targetLink.waitFor());
  await assert.doesNotReject(() => targetLink.getByText('E2E 路由角色', { exact: true }).waitFor());
  const targetRow = targetLink.locator('xpath=ancestor::li[1]');
  await targetRow.getByRole('button', { name: '更多对话操作', exact: true }).click();
  await assert.doesNotReject(() => targetRow.getByText('查看历史', { exact: true }).waitFor());
  await assert.doesNotReject(() => targetRow.getByText('导出 JSON', { exact: true }).waitFor());
  await targetRow.getByRole('button', { name: '更多对话操作', exact: true }).click();
  await inbox.getByRole('button', { name: '已归档', exact: true }).click();
  await assert.equal(await inbox.getByRole('button', { name: '已归档', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: path.join(outputDir, 'chat-inbox-mobile.png'), fullPage: true });

  await page.goto(baseURL + `/chat?character=${encodeURIComponent(manifest.ids.characterId)}&conversation=${encodeURIComponent(manifest.ids.conversationId)}`, { waitUntil: 'networkidle' });
  const composerInput = page.locator('input[placeholder^="发送消息给"]:visible');
  const sendButton = page.locator('button[aria-label="发送"]:visible');
  await composerInput.focus();
  await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error('visualViewport is unavailable for mobile keyboard simulation');
    const ownHeight = Object.getOwnPropertyDescriptor(viewport, 'height');
    Object.defineProperty(window, '__chatViewportHeightDescriptor', { value: ownHeight, configurable: true });
    Object.defineProperty(viewport, 'height', { value: 480, configurable: true });
    viewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(100);
  const keyboardLayout = await page.evaluate(() => ({
    appHeight: getComputedStyle(document.documentElement).getPropertyValue('--app-height'),
    input: document.querySelector('input[placeholder^="发送消息给"]')?.getBoundingClientRect().toJSON(),
    send: document.querySelector('button[aria-label="发送"]')?.getBoundingClientRect().toJSON(),
  }));
  assert.equal(keyboardLayout.appHeight.trim(), '480px', 'visualViewport resize must update --app-height');
  assert.ok(keyboardLayout.input && keyboardLayout.input.bottom <= 480, 'focused composer input must remain above the simulated keyboard');
  assert.ok(keyboardLayout.send && keyboardLayout.send.bottom <= 480, 'send control must remain above the simulated keyboard');
  await page.evaluate(() => {
    const viewport = window.visualViewport;
    const descriptor = window.__chatViewportHeightDescriptor;
    if (viewport) { if (descriptor) Object.defineProperty(viewport, 'height', descriptor); else delete viewport.height; viewport.dispatchEvent(new Event('resize')); }
    delete window.__chatViewportHeightDescriptor;
  });
  await page.waitForTimeout(50);

  const storyURL = `/chat?storyRun=${encodeURIComponent(manifest.ids.storyRunId)}`;
  await page.goto(baseURL + storyURL, { waitUntil: 'networkidle' });
  await assert.doesNotReject(() => page.getByRole('heading', { name: manifest.expected.storyTitle, exact: true }).waitFor());
  await page.getByRole('button', { name: '结束本章', exact: true }).click();
  await assert.doesNotReject(() => page.getByRole('dialog', { name: '确认结束本章' }).waitFor());
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await assert.equal(await page.getByRole('dialog', { name: '确认结束本章' }).count(), 0, 'cancel must not close the chapter');
  const composer = page.getByLabel('发送故事内容');
  await composer.fill('synthetic SSE message');
  let turnRequests = 0;
  await page.route(`**/api/story-runs/${manifest.ids.storyRunId}/turns`, async route => {
    turnRequests += 1;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: [
      'data: {"type":"accepted","turnId":"synthetic-turn","revision":1}',
      '',
      'data: {"type":"demo","turnId":"synthetic-turn"}',
      '',
      'data: {"type":"cost","turnId":"synthetic-turn","cost":{"amount":0}}',
      '',
      'data: {"type":"delta","turnId":"synthetic-turn","content":"synthetic reply"}',
      '',
      'data: {"type":"committed","turnId":"synthetic-turn","revision":2}',
      '',
      'data: {"type":"state_pending","turnId":"synthetic-turn","stateStatus":"PENDING"}',
      '',
      'data: {"costResult":{"amount":0}}',
      '',
      'data: {"type":"done","turnId":"synthetic-turn"}',
      '',
      '',
    ].join('\n') });
  });
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await assert.doesNotReject(() => page.getByText('synthetic reply', { exact: true }).waitFor());
  assert.equal(turnRequests, 1, 'one click must send one synthetic SSE request');
  await assert.doesNotReject(() => page.getByText('额度已按服务端结果更新。', { exact: true }).waitFor());
  await page.screenshot({ path: path.join(outputDir, 'chat-story-synthetic-sse.png'), fullPage: true });
  await context.close();
  console.log(JSON.stringify({ status: 'passed', mode: 'synthetic-ui', baseURL, checks: ['inbox search/archive/real fixture data', 'story route', 'synthetic accepted/demo/cost/delta/committed/state_pending/costResult/done'], noRealAiOrBilling: true }));
} finally { await browser.close(); }
