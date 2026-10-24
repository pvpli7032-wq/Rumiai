import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const manifestPath = process.env.FRONTEND_REDESIGN_FIXTURE_MANIFEST;
assert.ok(manifestPath, 'FRONTEND_REDESIGN_FIXTURE_MANIFEST is required');
const fixture = JSON.parse(await readFile(manifestPath, 'utf8'));
const baseURL = process.env.FRONTEND_REDESIGN_BASE_URL ?? 'http://127.0.0.1:3310';
const outputDir = process.env.FRONTEND_REDESIGN_OUTPUT_DIR ?? path.join(process.env.FRONTEND_REDESIGN_ARTIFACTS ?? '/tmp', 'community-e2e');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/usr/lib64/chromium-browser/headless_shell';
const {ids, locale = 'zh', login} = fixture;
for (const key of ['circleId', 'postId', 'voteDisputeId', 'ownedDisputeId', 'mirrorShareId']) assert.ok(ids?.[key], `fixture ids.${key} is required`);
assert.ok(login?.email && login?.password, 'fixture login is required');
await mkdir(outputDir, {recursive: true});

const results = [];
async function step(name, action) { try { await action(); results.push({name, status: 'pass'}); } catch (cause) { results.push({name, status: 'fail', error: cause instanceof Error ? cause.message : String(cause)}); throw cause; } }
function notApplicable(name, reason) { results.push({name, status: 'not-applicable', reason}); }
async function loginTo(page) {
  await page.goto(`${baseURL}/login`, {waitUntil: 'networkidle'});
  await page.locator('input[type="email"]').fill(login.email);
  await page.locator('input[type="password"]').first().fill(login.password);
  const [response] = await Promise.all([page.waitForResponse(item => item.url().endsWith('/api/auth/login') && item.request().method() === 'POST'), page.getByRole('button', {name: '登录', exact: true}).click()]);
  assert.ok(response.ok(), `fixture login failed: ${response.status()}`);
  await page.waitForURL(url => !url.pathname.endsWith('/login'), {timeout: 10_000});
}

const browser = await chromium.launch({executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
try {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, deviceScaleFactor: 1});
  await context.route('**/*', async route => { const url = new URL(route.request().url()); if (url.origin !== baseURL) return route.abort(); return route.continue(); });
  const page = await context.newPage();
  await loginTo(page);

  await step('square fixture feed and real search handoff', async () => {
    const evidence = {beforeUrl: '', afterUrl: '', api: null, expectedCircle: {id: ids.circleId, name: fixture.expected.circleName}};
    try {
      await page.goto(`${baseURL}/square`, {waitUntil: 'networkidle'});
      await page.getByText(fixture.expected.postTitle, {exact: true}).waitFor();
      evidence.beforeUrl = page.url();
      await page.getByLabel('搜索圈子').fill(fixture.expected.circleName);
      // Register before click: query comparison is decoded URLSearchParams, never raw +/%20 text.
      const searchResponse = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.origin === baseURL && url.pathname === '/api/circles' && url.searchParams.get('search') === fixture.expected.circleName;
      });
      await page.getByRole('button', {name: '搜索', exact: true}).click();
      await page.waitForURL(url => url.pathname === '/circles' && url.searchParams.get('search') === fixture.expected.circleName);
      evidence.afterUrl = page.url();
      const response = await searchResponse;
      const rows = await response.json();
      evidence.api = {url: response.url(), status: response.status(), body: rows};
      assert.ok(response.ok(), 'circle search API must return success');
      assert.ok(Array.isArray(rows) && rows.some(row => row.id === ids.circleId && row.name === fixture.expected.circleName), 'circle search API must return the seeded circle');
      const circleLink = page.locator(`a[href="/circles/${ids.circleId}"]`);
      const circleCard = page.locator('li').filter({has: circleLink});
      await circleCard.getByRole('heading', {level: 2}).filter({hasText: fixture.expected.circleName}).waitFor();
      await circleLink.click();
      await page.waitForURL(url => url.pathname === `/circles/${ids.circleId}`);
    } catch (cause) {
      evidence.afterUrl ||= page.url();
      evidence.pageBody = await page.locator('body').innerText().catch(() => 'unavailable');
      await writeFile(path.join(outputDir, 'square-search-failure.json'), JSON.stringify(evidence, null, 2));
      await page.screenshot({path: path.join(outputDir, 'square-search-failure.png'), fullPage: true}).catch(() => {});
      throw cause;
    }
  });

  await step('circle detail comment, upload failure injection, edit and delete cancel', async () => {
    const postsResponse = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === `/api/circles/${ids.circleId}/posts`);
    await page.goto(`${baseURL}/circles/${ids.circleId}`, {waitUntil: 'networkidle'});
    const posts = await postsResponse;
    assert.ok(posts.ok(), 'circle posts must load for ownership checks');
    const postRows = await posts.json();
    const ownedPost = postRows.posts.find(post => post.isMine);
    assert.ok(ownedPost, 'fixture must contain a post owned by the logged-in user for edit/delete cancellation');
    const ownedPostCard = page.locator(`li#post-${ownedPost.id}`);
    const postCard = page.locator(`li#post-${ids.postId}`);
    await postCard.getByText(fixture.expected.postTitle, {exact: true}).waitFor();
    const comment = 'M5 隔离评论验证';
    await postCard.getByLabel(`评论 ${ids.postId}`, {exact: true}).fill(comment);
    await postCard.getByRole('button', {name: '发表评论', exact: true}).click();
    await postCard.getByText(comment, {exact: true}).waitFor();
    await postCard.getByLabel(`评论图片 ${ids.postId}`, {exact: true}).setInputFiles({name: 'not-an-image.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture browser validation')});
    await page.getByRole('status').getByText(/图片仅支持/).waitFor();
    // ids.postId belongs to the fixture admin; its first Edit control is the user's new comment, not the post.
    await ownedPostCard.getByRole('button', {name: '编辑', exact: true}).first().click();
    const edited = `${ownedPost.content} M5编辑验证`;
    await ownedPostCard.getByLabel('编辑帖子内容', {exact: true}).fill(edited);
    await ownedPostCard.getByRole('button', {name: '保存', exact: true}).click();
    await ownedPostCard.getByText(edited, {exact: true}).waitFor();
    let deleteRequests = 0;
    const onDeleteRequest = request => { if (request.method() === 'DELETE' && new URL(request.url()).pathname === `/api/posts/${ownedPost.id}`) deleteRequests++; };
    page.on('request', onDeleteRequest);
    const dialogHandled = page.waitForEvent('dialog').then(dialog => dialog.dismiss());
    await Promise.all([
      ownedPostCard.getByRole('button', {name: '删除', exact: true}).first().click(),
      dialogHandled,
    ]);
    await ownedPostCard.getByText(edited, {exact: true}).waitFor();
    assert.equal(deleteRequests, 0, 'cancelling post deletion must not send DELETE');
    page.off('request', onDeleteRequest);
  });

  await step('subscription cancellation dialog can be cancelled', async () => {
    await page.goto(`${baseURL}/circles`, {waitUntil: 'networkidle'});
    await page.getByRole('button', {name: `取消订阅 ${fixture.expected.circleName}`}).click();
    const dialog = page.getByRole('dialog', {name: '取消订阅'});
    await dialog.waitFor();
    await dialog.getByRole('button', {name: '保留订阅'}).click();
    await assert.doesNotReject(() => dialog.waitFor({state: 'hidden'}));
  });

  await step('non-author dispute vote and owned dispute withdrawal cancellation', async () => {
    await page.goto(`${baseURL}/${locale}/disputes/${ids.voteDisputeId}`, {waitUntil: 'networkidle'});
    const votePanel = page.locator('section[aria-label="投票"]');
    await votePanel.waitFor();
    const voteResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(`/api/disputes/${ids.voteDisputeId}/vote`));
    await votePanel.getByRole('button').first().click();
    const response = await voteResponse;
    assert.ok(response.ok(), `fixture non-author vote failed: ${response.status()}`);
    await page.getByText('投票已记录。', {exact: true}).waitFor();

    await page.goto(`${baseURL}/${locale}/disputes/${ids.ownedDisputeId}`, {waitUntil: 'networkidle'});
    await page.getByRole('button', {name: '撤回案例', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: '撤回案例'});
    await dialog.waitFor();
    await dialog.getByRole('button', {name: '保留案例'}).click();
    await assert.doesNotReject(() => dialog.waitFor({state: 'hidden'}));
  });

  await step('mirror closed-or-enabled state and result deletion cancellation', async () => {
    await page.goto(`${baseURL}/${locale}/mirror`, {waitUntil: 'networkidle'});
    const mirrorHomeText = await page.locator('body').innerText();
    assert.ok(mirrorHomeText.includes('暂时关闭') || mirrorHomeText.includes('先选一个角色'), 'mirror must expose its server-configured closed or enabled state');
    await page.goto(`${baseURL}/${locale}/mirror/${ids.mirrorShareId}`, {waitUntil: 'networkidle'});
    await page.getByRole('button', {name: '删除这条结果', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: '删除这条结果'});
    await dialog.waitFor();
    await dialog.getByRole('button', {name: '取消', exact: true}).click();
    await assert.doesNotReject(() => dialog.waitFor({state: 'hidden'}));
  });

  await step('report evidence disclosure is reachable', async () => {
    await page.goto(`${baseURL}/${locale}/disputes/${ids.disputeId}`, {waitUntil: 'networkidle'});
    await page.getByRole('button', {name: '举报案例', exact: true}).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('提交时会保存所选内容作为处理依据；内容删除后，这份举报依据仍会保留。', {exact: true}).waitFor();
    await dialog.getByLabel('关闭').click();
  });

  await step('appeal load failure retry is reachable via browser fault injection', async () => {
    let injected = true;
    await page.route('**/api/community-appeals', async route => injected ? route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'M5 injected appeal load failure'})}) : route.continue());
    await page.goto(`${baseURL}/community-appeal`, {waitUntil: 'networkidle'});
    await page.getByRole('alert').getByText('M5 injected appeal load failure', {exact: true}).waitFor();
    injected = false;
    await page.getByRole('button', {name: '重试加载', exact: true}).click();
    await page.getByRole('heading', {name: '我的申诉记录', exact: true}).waitFor();
    await page.unroute('**/api/community-appeals');
  });

  await page.screenshot({path: path.join(outputDir, 'community-mobile-final.png'), fullPage: true});
  await context.close();
} finally {
  await browser.close();
  await writeFile(path.join(outputDir, 'community-e2e-report.json'), JSON.stringify({baseURL, manifestPath, results, note: 'Writes only to parent-provided isolated fixture. Upload failure is browser-side invalid-MIME injection; dispute voting is explicitly not-applicable because the fixture contains one owner user.'}, null, 2));
}
console.log(JSON.stringify({status: 'PASS', suite: 'frontend-redesign-community', results}));