import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:18780';
const out = path.resolve(process.env.BROWSER_TEST_OUT || '../../browser-m0');
const chinese = process.env.TEST_UI_LANGUAGE === 'zh';
const real = process.env.TEST_REAL_AI === 'true';
const copy = chinese ? {
  start: '开始聊天', comments: '评论', send: '发送', report: '举报', cancel: '取消',
  publish: '发布角色', sex: '色情内容', submitReport: '提交举报', reported: '举报已提交',
} : {
  start: 'เริ่มคุย', comments: 'คอมเมนต์', send: 'ส่ง', report: 'รายงาน', cancel: 'ยกเลิก',
  publish: 'เผยแพร่ตัวละคร', sex: 'เนื้อหาทางเพศ', submitReport: 'ส่งรายงาน', reported: 'ส่งรายงานแล้ว',
};
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await context.newPage();
page.setDefaultTimeout(45000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const checks = [];
const check = name => { checks.push(name); console.log('PASS', name); };
try {
  const stamp = Date.now();
  const email = `browser_${stamp}@example.com`;
  await page.goto(`${base}/register`);
  await page.locator('form input[type="text"]').fill(`browser_${stamp}`);
  await page.locator('form input[type="email"]').fill(email);
  await page.locator('form input[type="password"]').fill('Password123!');
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/discover/);
  await page.locator('button[aria-haspopup="dialog"]').first().waitFor();
  check('浏览器注册及登录态');
  await page.locator('button[aria-haspopup="dialog"]').first().click();
  await page.getByRole('button', { name: copy.start, exact: true }).waitFor();
  check('角色详情');
  await page.getByRole('button', { name: new RegExp(`^${copy.comments}`) }).first().click();
  const comment = `浏览器评论验收 ${stamp}`;
  await page.locator('[role="dialog"] textarea').first().fill(comment);
  await page.getByRole('button', { name: copy.send, exact: true }).first().click();
  await page.getByText(comment).waitFor();
  check('浏览器发布评论');
  await page.getByRole('button', { name: copy.report, exact: true }).first().click();
  await page.getByRole('button', { name: copy.sex, exact: true }).click();
  await page.getByRole('button', { name: copy.submitReport, exact: true }).click();
  await page.getByText(copy.reported, { exact: true }).waitFor();
  await page.screenshot({ path: path.join(out, 'report.png') });
  await page.getByRole('dialog', { name: copy.reported, exact: true }).getByRole('button', { name: chinese ? '关闭' : 'ปิด', exact: true }).last().click();
  check('浏览器提交举报');
  await page.getByRole('button', { name: copy.start, exact: true }).click();
  await page.waitForURL(/\/chat/);
  await page.locator('form input[type="text"]').fill('你好，今天怎么样？');
  const replyRequest = page.waitForResponse(r => /\/api\/conversations\/[^/]+\/messages$/.test(r.url()) && r.request().method() === 'POST');
  await page.locator('form button[type="submit"]').click();
  const reply = await replyRequest;
  const replyWire = await reply.text();
  assert.equal(reply.status(), 200);
  assert.match(replyWire, /\[DONE\]/);
  assert.doesNotMatch(replyWire, /"error"\s*:/);
  if (real) assert.doesNotMatch(replyWire, /"demo"\s*:\s*true|模拟 AI 回复/);
  else await page.getByText(/模拟/).first().waitFor();
  await page.waitForFunction(() => !document.querySelector('form input[type="text"]')?.disabled);
  await page.screenshot({ path: path.join(out, 'chat.png') });
  await page.reload();
  if (real) {
    await page.waitForFunction(() => document.querySelectorAll('.group\\/msg').length >= 2);
    check('浏览器真实 AI 回复、SSE、刷新后历史保存');
  } else {
    await page.getByText(/【模拟 AI 回复，仅供测试】/).first().waitFor();
    check('浏览器发送消息、SSE、模拟标识刷新后保留');
  }
  await page.goto(`${base}/creator`);
  const name = `中文验收角色${stamp}`;
  const inputs = page.locator('#identity input');
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill('一位温和的图书馆管理员');
  await page.locator('#persona textarea').nth(0).fill('说话温和简洁，帮助访客找到书籍。喜欢文学和历史，总是耐心倾听，会根据读者的兴趣推荐书籍，保持图书馆管理员的人设。');
  await page.getByRole('button', { name: copy.publish }).first().click();
  await page.waitForURL(/\/chat\?character=/);
  await page.getByText(name, { exact: true }).first().waitFor();
  check('浏览器创建角色并进入聊天');
  await page.goto(`${base}/shop`);
  await page.getByRole('button', { name: /模拟充值/ }).first().click();
  await page.getByText(chinese ? '模拟充值成功' : 'ซื้อสำเร็จ!', { exact: true }).waitFor();
  check('浏览器模拟金币充值');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/discover', '/creator', '/profile', '/chat', '/shop']) {
    await page.goto(`${base}${route}`);
    await page.waitForLoadState('networkidle');
    const sizes = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, width: innerWidth }));
    assert(sizes.doc <= sizes.width + 1, `${route} horizontal overflow ${JSON.stringify(sizes)}`);
    await page.screenshot({ path: path.join(out, `mobile-${route.slice(1)}.png`) });
  }
  check('390px 移动端五个主要页面无横向溢出');
  assert.deepEqual(errors, [], '浏览器出现运行错误');
  check('无浏览器运行错误');
} catch (e) {
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  throw e;
} finally {
  await writeFile(path.join(out, 'result.json'), JSON.stringify({ base, checks, errors }, null, 2));
  await browser.close();
}
