import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseURL = process.env.FRONTEND_REDESIGN_BASE_URL || 'http://127.0.0.1:3310';
const manifestPath = process.env.FRONTEND_REDESIGN_FIXTURE_MANIFEST;
const outputDir = process.env.FRONTEND_REDESIGN_OUTPUT_DIR || '/tmp/khui-m2-discovery-qa';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/lib64/chromium-browser/headless_shell';
assert.ok(manifestPath, 'FRONTEND_REDESIGN_FIXTURE_MANIFEST is required; run under the isolated fixture parent on 3310');
const fixture = JSON.parse(await readFile(manifestPath, 'utf8'));
assert.equal(fixture.synthetic, true, 'discovery e2e only accepts the isolated synthetic fixture manifest');
assert.ok(fixture.login?.email && fixture.login?.password && fixture.ids?.characterId, 'fixture login and characterId are required');
await mkdir(outputDir, { recursive: true });

const report = { baseURL, manifestPath, checks: [], injectedFailures: [], notApplicable: [] };
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
let context;
try {
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await context.newPage();
  const login = async () => {
    await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' });
    await page.locator('input[type=email]').fill(fixture.login.email);
    await page.locator('input[type=password]').first().fill(fixture.login.password);
    await page.locator('form').getByRole('button', { name: /登录/ }).click();
    await page.waitForURL(url => !url.pathname.endsWith('/login'));
  };
  await login();

  // Fault injection is browser-local: the isolated API stays untouched. It proves the
  // M2 error/retry presentation without treating an injected error as a live API result.
  let failDiscover = true;
  await page.route('**/api/characters?sort=*', async route => {
    if (failDiscover) {
      report.injectedFailures.push(route.request().url());
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'injected discovery failure' }) });
    } else await route.continue();
  });
  await page.goto(`${baseURL}/discover`, { waitUntil: 'networkidle' });
  await expectText(page, '角色加载失败');
  failDiscover = false;
  await (await firstVisible(page.getByRole('button', { name: '重试', exact: true }))).click();
  await expectText(page, fixture.expected.characterTitle);
  report.checks.push('injected discover failure renders retry and reloads into isolated fixture data');
  await page.unroute('**/api/characters?sort=*');

  const search = await firstVisible(page.getByLabel('搜索角色'));
  await search.fill(fixture.expected.characterTitle);
  await expectText(page, fixture.expected.characterTitle);
  await search.fill('不存在的E2E筛选值');
  await page.getByRole('button', { name: '角色', exact: true }).count().catch(() => 0);
  // Switch to the full catalogue using the actual action; the empty state must be data-driven.
  await (await firstVisible(page.getByRole('button', { name: /浏览全部/ }))).click();
  await expectText(page, '没有符合条件的角色');
  report.checks.push('search and empty filter state use fixture character data');

  assert.ok(fixture.ids.sceneCharacterId, 'fixture must provide static-config sceneCharacterId');
  const sceneCharacter = await page.evaluate(async (id) => {
    const response = await fetch(`/api/characters/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`scene character lookup failed: ${response.status}`);
    return response.json();
  }, fixture.ids.sceneCharacterId);
  const sceneName = sceneCharacter.character?.name;
  assert.ok(sceneName, 'fixture scene character must expose a name');
  await page.goto(`${baseURL}/discover`, { waitUntil: 'networkidle' });
  await (await firstVisible(page.getByLabel('搜索角色'))).fill(sceneName);
  await (await firstVisible(page.getByRole('button', { name: /浏览全部/ }))).click();
  await (await firstVisible(page.getByRole('button', { name: sceneName, exact: false }))).click();
  const sceneAction = await firstVisible(page.getByRole('button', { name: '进入场景', exact: true }));
  let aiTurnPosts = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/conversations\/[^/]+\/turns/.test(request.url())) aiTurnPosts += 1; });
  await sceneAction.click();
  await page.waitForURL(url => url.pathname === '/chat' && url.searchParams.get('character') === fixture.ids.sceneCharacterId && url.searchParams.get('scene') === '1');
  await page.waitForTimeout(150);
  assert.equal(aiTurnPosts, 0, 'opening a scene must not send an AI turn');
  report.checks.push('detail dialog enters configured scene with character+scene=1 and no AI turn POST');

  await page.goto(`${baseURL}/discover`, { waitUntil: 'networkidle' });
  await (await firstVisible(page.getByRole('button', { name: fixture.expected.characterTitle, exact: false }))).click();
  let likePosts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/api/characters/${fixture.ids.characterId}/like`)) likePosts += 1; });
  const like = page.getByRole('button', { name: '点赞', exact: true });
  await like.evaluate(button => { button.click(); button.click(); });
  await page.waitForTimeout(350);
  assert.equal(likePosts, 1, 'pending like must suppress duplicate POSTs');
  report.checks.push('like pending state suppresses duplicate POST');

  let rollback = true;
  await page.route(`**/api/characters/${fixture.ids.characterId}/like`, async route => {
    if (rollback && route.request().method() === 'DELETE') { await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }); rollback = false; }
    else await route.continue();
  });
  await page.getByRole('button', { name: '已点赞', exact: true }).click();
  await page.waitForTimeout(200);
  await expectText(page, '点赞操作失败');
  await expectText(page, '已点赞');
  await page.unroute(`**/api/characters/${fixture.ids.characterId}/like`);
  report.injectedFailures.push('DELETE /api/characters/:id/like => 500');
  report.checks.push('like rollback preserves server-confirmed state after injected failure');

  const bookmark = await firstVisible(page.getByRole('button', { name: /保存|已收藏/ }));
  const bookmarkInitiallySaved = (await bookmark.innerText()).includes('已收藏');
  const firstBookmarkMethod = bookmarkInitiallySaved ? 'DELETE' : 'POST';
  let bookmarkRequests = 0;
  page.on('request', request => {
    if (request.method() === firstBookmarkMethod && request.url().endsWith(`/api/characters/${fixture.ids.characterId}/bookmark`)) bookmarkRequests += 1;
  });
  await bookmark.evaluate(button => { button.click(); button.click(); });
  await page.waitForTimeout(250);
  assert.equal(bookmarkRequests, 1, `pending bookmark must suppress duplicate ${firstBookmarkMethod}`);
  const savedAfterFirst = !bookmarkInitiallySaved;
  const rollbackMethod = savedAfterFirst ? 'DELETE' : 'POST';
  let rollbackBookmark = true;
  await page.route(`**/api/characters/${fixture.ids.characterId}/bookmark`, async route => {
    if (rollbackBookmark && route.request().method() === rollbackMethod) {
      rollbackBookmark = false;
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    } else await route.continue();
  });
  await (await firstVisible(page.getByRole('button', { name: savedAfterFirst ? '已收藏' : '保存', exact: true }))).click();
  await expectText(page, '收藏操作失败');
  await firstVisible(page.getByRole('button', { name: savedAfterFirst ? '已收藏' : '保存', exact: true }));
  await page.unroute(`**/api/characters/${fixture.ids.characterId}/bookmark`);
  report.injectedFailures.push(`${rollbackMethod} /api/characters/:id/bookmark => 500`);
  report.checks.push(`bookmark initial ${bookmarkInitiallySaved ? 'saved' : 'unsaved'} state uses one ${firstBookmarkMethod} and rolls back after injected ${rollbackMethod} failure`);

  let giftPosts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes(`/api/characters/${fixture.ids.characterId}/gift`)) giftPosts += 1; });
  const giftCandidates = page.locator('button').filter({ hasText: /金币/ });
  assert.ok(await giftCandidates.count(), 'fixture must provide an active gift option');
  const gift = await firstVisible(giftCandidates);
  page.once('dialog', dialog => dialog.dismiss());
  await gift.click();
  await page.waitForTimeout(150);
  assert.equal(giftPosts, 0, 'dismissed gift confirmation must not POST');
  report.checks.push('gift confirmation cancel sends no POST');

  await page.getByRole('button', { name: '评论', exact: true }).click();
  const commentText = `E2E discovery comment ${Date.now()}`;
  await page.getByPlaceholder('写下评论…').fill(commentText);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expectText(page, commentText);
  let commentDeletes = 0;
  page.on('request', request => { if (request.method() === 'DELETE' && request.url().includes('/api/comments/')) commentDeletes += 1; });
  page.once('dialog', dialog => dialog.dismiss());
  await (await firstVisible(page.getByLabel('删除评论'))).click();
  await page.waitForTimeout(150);
  assert.equal(commentDeletes, 0, 'dismissed comment deletion must not DELETE');
  report.checks.push('comment deletion confirmation cancel sends no DELETE');

  const locale = fixture.locale || 'zh';
  for (const route of [`/${locale}`, `/${locale}/explore`, `/announcements`, `/pages/${fixture.ids.cmsPageSlug}`]) {
    const response = await page.goto(`${baseURL}${route}`, { waitUntil: 'networkidle' });
    assert.equal(response?.status(), 200, `${route} must remain publicly readable with fixture/CMS fallback`);
    assert.ok(await page.locator('main').count(), `${route} must render public shell`);
  }
  report.checks.push('public CMS and locale fallback routes render against isolated fixture');
  await page.screenshot({ path: path.join(outputDir, 'm2-discovery-mobile.png'), fullPage: true });
} finally {
  await context?.close();
  await browser.close();
  await writeFile(path.join(outputDir, 'discovery-report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ status: 'passed', ...report }));

async function firstVisible(locator, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible()) return candidate;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`no visible locator found after ${timeout}ms; matched ${await locator.count()} nodes`);
}

async function expectText(page, text) {
  // AppFrame keeps duplicate desktop/mobile navigation nodes mounted. Never use .first()
  // for fixture text: it can select a deliberately hidden navigation copy.
  await firstVisible(page.getByText(text, { exact: false }));
}
