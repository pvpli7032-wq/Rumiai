import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:18782';
const out = process.env.V0_TEST_OUT || '../../v0-story';
await mkdir(out, {recursive: true});
const browser = await chromium.launch();
const context = await browser.newContext({viewport: {width: 1280, height: 900}, locale: 'zh-CN'});
const page = await context.newPage();
const checks = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const check = label => { checks.push(label); console.log('PASS', label); };

try {
  // 精选场景绑在 seed 出来的 xingban-original-3/4/5 上；库没 seed 过就一个都列不出来，
  // 先明确报前置缺失，别让后面那条「应有三个」的断言看起来像功能坏了。
  const seeded = await context.request.get(base + '/api/characters?page=1&pageSize=100');
  assert.equal(seeded.status(), 200);
  // 这个端点直接返回数组，不是 {items}。
  const seededIds = (await seeded.json()).map(item => item.id);
  assert(seededIds.includes('xingban-original-3') && seededIds.includes('xingban-original-4') && seededIds.includes('xingban-original-5'),
    '此脚本需要已执行 prisma/seed.ts（基础 6 位）与 prisma/seed-community.ts 的库，缺 xingban-original-3/4/5');
  const stamp = Date.now();
  const registration = await context.request.post(base + '/api/auth/register', {
    data: {name: '场景验收', email: 'v0story' + stamp + '@example.com', password: 'Password123!'},
  });
  assert.equal(registration.status(), 201);
  const {token} = await registration.json();
  await page.goto(base + '/discover');
  await page.evaluate(value => localStorage.setItem('xingban_token', value), token);

  // 1) 发现页精选场景区：只列有配置且角色真实存在的场景。
  await page.goto(base + '/discover');
  await page.waitForLoadState('networkidle');
  const sceneCards = page.locator('section', {has: page.getByRole('heading', {name: '精选场景'})}).locator('a[href*="scene=1"]');
  assert.equal(await sceneCards.count(), 3, '应有三个精选场景入口');
  for (const href of await sceneCards.evaluateAll(links => links.map(link => link.getAttribute('href')))) {
    assert.match(href, /^\/chat\?character=xingban-original-[345]&scene=1$/);
  }
  const sceneSection = page.locator('section', {has: page.getByRole('heading', {name: '精选场景'})});
  await sceneSection.getByText('从一个具体事件开始').waitFor();
  await page.screenshot({path: out + '/discover-scenes.png', fullPage: false});
  check('发现页精选场景区展示三个真实角色场景且链接带 scene=1');

  // 2) 角色详情弹层：只对绑定角色显示场景头部与「进入场景」。
  const openDialog = async id => {
    await page.goto(base + '/discover');
    await page.waitForLoadState('networkidle');
    await page.getByRole('textbox', {name: '搜索角色'}).fill(id);
    await page.waitForTimeout(300);
    await page.locator('button[aria-haspopup="dialog"]').first().click();
    await page.getByRole('dialog').waitFor();
  };
  await openDialog('墨白');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', {name: '深夜工作室：一段没发出去的旋律'}).waitFor();
  await dialog.getByRole('heading', {name: '我是谁'}).waitFor();
  await dialog.getByRole('button', {name: '进入场景'}).waitFor();
  await page.screenshot({path: out + '/dialog-scene.png'});
  check('墨白详情弹层显示场景三要素与「进入场景」');

  await openDialog('林澈');
  const plainDialog = page.getByRole('dialog');
  await plainDialog.getByRole('button', {name: '开始聊天'}).waitFor();
  assert.equal(await plainDialog.getByRole('button', {name: '进入场景'}).count(), 0);
  assert.equal(await plainDialog.getByRole('heading', {name: '我是谁'}).count(), 0);
  check('无配置角色保持原有详情与「开始聊天」，不出现场景元素');

  // 3) 场景态聊天页：开场、三条建议、结束入口。
  await page.goto(base + '/chat?character=xingban-original-4&scene=1');
  await page.locator('form input[type=text]').waitFor();
  await page.getByText('今晚，墨白把一段没有发出去的旋律放给你听。').waitFor();
  const suggestions = page.getByRole('group', {name: '建议动作，可填入草稿后修改'}).getByRole('button');
  assert.equal(await suggestions.count(), 3);
  const input = page.locator('form input[type=text]');
  assert.equal(await input.inputValue(), '');
  await suggestions.first().click();
  const draft = await input.inputValue();
  assert.ok(draft.length > 0, '点选建议后草稿应被填入');
  await page.getByText('今晚，墨白把一段没有发出去的旋律放给你听。').waitFor();
  check('点选建议只填草稿，不发送、不离开空会话');
  await page.screenshot({path: out + '/chat-scene.png'});
  check('场景态展示开场与三条建议，点选只填草稿不发送');

  // 4) 结束本次体验：确认弹层文案 → 本地回顾视图，不写库不换会话。
  await page.getByRole('button', {name: '结束本次体验'}).click();
  const endDialog = page.getByRole('dialog');
  await endDialog.getByText('只结束本次体验，不会判定章节完成。').waitFor();
  await endDialog.getByRole('button', {name: '结束本次体验'}).click();
  await page.getByText('本次体验回看').waitFor();
  await page.getByRole('heading', {name: '深夜工作室：一段没发出去的旋律'}).waitFor();
  await page.getByText('还没有可回看的片段').waitFor();
  // Scope the wording check to the review view itself: the surrounding chat shell
  // (relationship panel etc.) legitimately contains other copy.
  const bodyText = await page.locator('main, body').first().locator('section').first().innerText();
  for (const banned of ['已完成', '已保存', '下一章', '永久记忆']) {
    assert.equal(bodyText.includes(banned), false, '结束视图不得出现：' + banned);
  }
  await page.screenshot({path: out + '/chapter-close.png'});
  check('结束确认后进入本地回顾视图，措辞不含完成/保存/下一章');

  // V0 deliberately ships no next-chapter entry: ending must not look like unlocking anything.
  assert.equal(await page.getByRole('link', {name: /下一章/}).count(), 0);
  assert.equal(await page.getByRole('button', {name: /下一章/}).count(), 0);
  await page.getByRole('heading', {name: '还可以继续探索'}).waitFor();
  await page.getByRole('button', {name: '继续这段对话'}).click();
  await page.locator('form input[type=text]').waitFor();
  assert.equal(page.url().includes('scene=1'), true, '回到聊天不应改变地址');
  check('回顾视图只有回到原会话的入口，没有下一章，且能恢复输入区');

  // 5) 非场景态：同一个角色不带 scene=1 时不出现任何场景元素。
  await page.goto(base + '/chat?character=xingban-original-4');
  await page.locator('form input[type=text]').waitFor();
  assert.equal(await page.getByRole('group', {name: '建议动作，可填入草稿后修改'}).count(), 0);
  assert.equal(await page.getByRole('button', {name: '结束本次体验'}).count(), 0);
  check('缺少 scene=1 时回到原有聊天界面');

  // 6) 未绑定场景的角色带 scene=1 也只是普通聊天。
  await page.goto(base + '/chat?character=xingban-original-0&scene=1');
  await page.locator('form input[type=text]').waitFor();
  assert.equal(await page.getByRole('group', {name: '建议动作，可填入草稿后修改'}).count(), 0);
  assert.equal(await page.getByRole('button', {name: '结束本次体验'}).count(), 0);
  check('无配置角色即使带 scene=1 也不进入场景态');

  // 7) 公开角色页入口。
  await page.goto(base + '/zh/character/xingban-original-3');
  await page.getByText('本角色有一个可体验的场景').waitFor();
  const entry = page.getByRole('link', {name: '查看场景'});
  const entryHref = await entry.getAttribute('href');
  assert.match(entryHref, /^\/(zh\/)?chat\?character=xingban-original-3&scene=1$/, '场景入口应指向聊天页并带 scene=1：' + entryHref);
  const entryResponse = await page.request.get(base + entryHref);
  assert.equal(entryResponse.status(), 200, '场景入口地址应能打开');
  await page.goto(base + '/zh/character/xingban-original-0');
  assert.equal(await page.getByText('本角色有一个可体验的场景').count(), 0);
  check('公开角色页只为绑定角色渲染场景入口');

  assert.deepEqual(errors, []);
  check('全程无前端运行错误');
} catch (error) {
  await page.screenshot({path: out + '/failure.png'}).catch(() => {});
  throw error;
} finally {
  await writeFile(out + '/result.json', JSON.stringify({checks, errors}, null, 2));
  await browser.close();
}