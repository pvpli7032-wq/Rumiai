import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:18782';
const out = process.env.STORY_TEST_OUT || 'artifacts/story-browser';
await mkdir(out, {recursive: true});

const browser = await chromium.launch();
const checks = [];
const errors = [];
const check = label => { checks.push(label); console.log('PASS', label); };

try {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, locale: 'zh-CN'});
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));

  const stamp = Date.now();
  const registration = await context.request.post(base + '/api/auth/register', {data: {name: '故事验收', email: 'story' + stamp + '@example.com', password: 'Password123!'}});
  assert.equal(registration.status(), 201);
  const {token} = await registration.json();

  // 1) 目录接口：只暴露公开字段，未发布/不存在的 slug 一律 404。
  const catalog = await context.request.get(base + '/api/stories');
  assert.equal(catalog.status(), 200);
  const catalogBody = await catalog.json();
  assert.ok(Array.isArray(catalogBody.items) && catalogBody.items.length >= 1, '目录里应有已发布的试点故事');
  const slug = catalogBody.items[0].slug;
  for (const secret of ['hiddenFacts', 'definitionJson', 'characterSnapshotJson', 'stateJson', 'prompt']) {
    assert.equal(JSON.stringify(catalogBody).includes(secret), false, '目录不得返回私有字段：' + secret);
  }
  assert.equal((await context.request.get(base + '/api/stories/does-not-exist-' + stamp)).status(), 404);
  check('目录接口返回已发布故事且不泄漏私有字段，未知 slug 404');

  // 1.5) 发现页的「故事体验」分区能到达入口页——否则入口页只能靠手输 URL 打开。
  await page.goto(base + '/discover');
  await page.waitForLoadState('networkidle');
  const storySection = page.locator('section', {has: page.getByRole('heading', {name: '故事体验'})});
  await storySection.waitFor({timeout: 15000});
  const storyLinks = storySection.locator('a[href^="/stories/"]');
  assert.ok((await storyLinks.count()) >= 1, '发现页故事分区应有入口链接');
  await storySection.getByRole('heading', {name: '故事体验'}).waitFor();
  check('发现页故事分区列出已发布故事并链到入口页');

  // 2) 入口页：标题、冲突、角色、章节、开始按钮。
  await page.goto(base + '/stories/' + slug);
  await page.waitForLoadState('networkidle');
  await page.getByRole('heading', {level: 1}).waitFor();
  const title = await page.getByRole('heading', {level: 1}).textContent();
  assert.ok(title && title.trim().length > 0);
  await page.getByRole('heading', {name: '这次会发生什么'}).waitFor();
  await page.getByRole('heading', {name: '你的身份'}).waitFor();
  await page.getByRole('heading', {name: '选择章节'}).waitFor();
  await page.screenshot({path: out + '/story-entry-desktop.png', fullPage: false});
  check('入口页展示标题、冲突、身份、章节');

  // 3) 未登录点开始 → 跳登录并带 next。
  await page.getByRole('button', {name: '开始故事'}).first().click();
  await page.waitForURL(url => url.pathname.includes('/login'), {timeout: 15000});
  check('未登录点开始会跳转登录');

  // 4) 已登录点开始 → 建实例并进入 /chat?storyRun=。
  await page.evaluate(value => localStorage.setItem('xingban_token', value), token);
  await page.goto(base + '/stories/' + slug);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', {name: '开始故事'}).first().click();
  await page.waitForURL(url => url.searchParams.has('storyRun'), {timeout: 20000});
  const runId = new URL(page.url()).searchParams.get('storyRun');
  assert.ok(runId && runId.length > 0);
  await page.getByRole('textbox', {name: '发送故事内容'}).waitFor({timeout: 20000});
  check('已登录点开始会创建故事实例并进入故事会话');

  // 5) 发一回合：用户气泡 + 助手回复。
  const input = page.getByRole('textbox', {name: '发送故事内容'});
  await input.fill('我把那块停在凌晨的怀表放在桌上。');
  await page.getByRole('button', {name: '发送'}).click();
  await page.getByText('我把那块停在凌晨的怀表放在桌上。').waitFor({timeout: 20000});
  await page.waitForFunction(() => document.querySelectorAll('article').length >= 2, null, {timeout: 45000});
  await page.screenshot({path: out + '/story-chat-turn.png', fullPage: false});
  check('故事会话可发送回合并收到回复');

  // 6) 刷新后从会话消息还原逐字历史。先等回合真正提交，再刷新——否则测的是
  //    「还没落库」而不是「落库后能否还原」。
  const runView = await (await context.request.get(base + '/api/story-runs/' + runId, {headers: {Authorization: 'Bearer ' + token}})).json();
  const conversationId = runView.run.conversationId;
  await page.waitForFunction(async () => true);
  let committed = null;
  for (let attempt = 0; attempt < 40 && !committed; attempt++) {
    const view = await (await context.request.get(base + '/api/story-runs/' + runId, {headers: {Authorization: 'Bearer ' + token}})).json();
    committed = (view.run.turns ?? []).find(turn => turn.status === 'COMMITTED' && turn.inputMessageId);
    if (!committed) await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(committed, '回合应在超时前提交并记录消息 ID');
  const messages = await (await context.request.get(base + '/api/conversations/' + conversationId + '/messages', {headers: {Authorization: 'Bearer ' + token}})).json();
  assert.ok(Array.isArray(messages) && messages.some(message => message.content.includes('怀表')), '会话消息里应有刚发送的正文：' + JSON.stringify(messages).slice(0, 400));
  await page.reload();
  await page.getByText('我把那块停在凌晨的怀表放在桌上。').waitFor({timeout: 20000});
  assert.equal(await page.getByRole('status').filter({hasText: '历史正文暂时无法读取'}).count(), 0, '正文应可还原，不应出现降级提示');
  check('刷新后能还原逐字对话正文');

  // 7) 不存在的故事 slug → not-found 页而不是白屏。
  const missing = await page.goto(base + '/stories/does-not-exist-' + stamp);
  assert.equal(missing.status(), 404);
  assert.ok((await page.textContent('body')).length > 0);
  check('不存在的故事返回 404 页面');

  // 8) 390px 入口页不横向溢出。
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(base + '/stories/' + slug);
  await page.waitForLoadState('networkidle');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, '390px 横向溢出 ' + overflow + 'px');
  await page.screenshot({path: out + '/story-entry-mobile.png', fullPage: false});
  check('390px 入口页无横向溢出');

  assert.deepEqual(errors, [], '页面不应有未捕获异常');
  console.log('STORY_CHECKS=' + checks.length);
  console.log('RESULT=PASS checks=' + checks.length + ' pageerrors=' + errors.length);
} finally {
  await browser.close();
}
