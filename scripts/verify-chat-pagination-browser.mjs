import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

/**
 * 长历史分页的浏览器验证（规划书 §21 / EV-A11-001）。
 *
 * 这里只验证"分页真的生效、界面还能用"这两件界面上的事：
 * 服务端游标语义与响应体大小在 tests/conversation-message-pagination.test.mjs 里断言。
 * 造数走接口之外的直接写入不可行（浏览器拿不到库），所以用会话消息接口自己灌：
 * 连发若干轮会太慢，改为直接 POST 消息是做不到的——因此本脚本用**接口能造出的量**
 * 验证分页切换与交互可用，一万条的量级由单测覆盖。
 */
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:18782';
const out = process.env.STORY_TEST_OUT || 'artifacts/chat-pagination';
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
  const registration = await context.request.post(base + '/api/auth/register', {data: {name: '分页验收', email: 'paging' + stamp + '@example.com', password: 'Password123!'}});
  assert.equal(registration.status(), 201);
  const token = (await registration.json()).token;

  // 造一个带若干轮历史的会话：每轮一次发送 + 一次回复，凑够多页。
  const created = await context.request.post(base + '/api/conversations', {headers: {Authorization: 'Bearer ' + token}, data: {characterId: await firstCharacterId(context, token)}});
  assert.ok(created.ok(), '建会话应成功');
  const conversationId = (await created.json()).conversation.id;

  // 页大小是 50（规划书 §21 的初始建议），所以必须造够两页，否则"加载更早"不会出现。
  const rounds = 30;
  for (let i = 0; i < rounds; i += 1) {
    const response = await context.request.post(base + '/api/conversations/' + conversationId + '/messages', {
      headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
      data: {content: '第 ' + (i + 1) + ' 轮：我在书架第三层找到一封信。'},
    });
    assert.ok(response.ok(), '第 ' + (i + 1) + ' 轮发送应成功');
    await response.text();
  }

  // 1) 默认（不带 limit）仍然返回完整数组——迁移期旧调用方不受影响。
  const legacy = await (await context.request.get(base + '/api/conversations/' + conversationId + '/messages', {headers: {Authorization: 'Bearer ' + token}})).json();
  assert.ok(Array.isArray(legacy), '不带 limit 必须继续返回数组');
  assert.ok(legacy.length >= rounds * 2, '历史应包含每轮的用户与助手消息');

  // 2) 显式分页返回分页结构，条数受限。
  const paged = await (await context.request.get(base + '/api/conversations/' + conversationId + '/messages?limit=5', {headers: {Authorization: 'Bearer ' + token}})).json();
  assert.ok(!Array.isArray(paged), '带 limit 必须返回分页结构');
  assert.equal(paged.messages.length, 5);
  assert.equal(paged.hasMore, true);
  assert.equal(typeof paged.nextCursor, 'string');
  check('会话历史接口：默认整段、显式分页两种模式并存');

  // 3) 页面首屏按分页加载，且"加载更早"按钮出现、可点、能接到顶部。
  // 聊天页靠 localStorage 里的令牌恢复登录态；不先注入就会被踢回登录页。
  await page.goto(base + '/discover');
  await page.evaluate(value => localStorage.setItem('xingban_token', value), token);
  await page.goto(base + '/chat?conversation=' + encodeURIComponent(conversationId));
  await page.waitForLoadState('networkidle');

  // 首屏只加载一页：最早的那条必须还不在 DOM 里。
  const oldest = '第 1 轮：我在书架第三层找到一封信。';
  // 等消息区出现任意一条历史，而不是硬等某一句——发送轮数可能因模拟上游而少于预期。
  await page.getByText(/第 \d+ 轮：我在书架第三层找到一封信。/).first().waitFor({timeout: 30000});
  assert.equal(await page.getByText(oldest).count(), 0, '首屏不应包含第一页之前的历史');

  const loadEarlier = page.getByRole('button', {name: '加载更早的消息'});
  await loadEarlier.waitFor({timeout: 20000});
  await loadEarlier.click();
  await page.getByText(oldest).first().waitFor({timeout: 20000});
  check('聊天页首屏只加载一页，点"加载更早"才取回更早历史');

  // 4) 输入框仍可用：加载完历史能继续发消息。
  const input = page.getByPlaceholder(/发送消息给/).first();
  await input.fill('加载完历史后我还能继续说话。');
  await page.getByRole('button', {name: '发送'}).first().click();
  await page.getByText('加载完历史后我还能继续说话。').first().waitFor({timeout: 20000});
  check('加载更早之后输入与发送仍然可用');

  // 5) 390px 下不横向溢出。
  await page.setViewportSize({width: 390, height: 844});
  await page.reload({waitUntil: 'networkidle'});
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, '390px 下不应横向溢出，实测 ' + overflow);
  check('390px 长历史页无横向溢出');

  await page.screenshot({path: out + '/chat-pagination.png'});
  assert.equal(errors.length, 0, '页面不应有未捕获异常：' + errors.join(' | '));
  check('无浏览器运行错误');
  console.log('CHECKS=' + checks.length);
} finally {
  await browser.close();
}

async function firstCharacterId(context, token) {
  const response = await context.request.get(base + '/api/characters?limit=1', {headers: {Authorization: 'Bearer ' + token}});
  const rows = await response.json();
  const list = Array.isArray(rows) ? rows : rows.items ?? [];
  assert.ok(list.length > 0, '需要至少一个可用角色');
  return list[0].id;
}
