/**
 * M2「角色创作」浏览器验收：手机创角 → 编辑 → 发布 → 下架整条闭环。
 *
 * 依赖外部准备好的隔离实例（TEST_BASE_URL），以及：
 *   TEST_REVIEWER_EMAIL / TEST_REVIEWER_PASSWORD —— 拥有 moderation.write 的审核账号。
 * 这两个由 scripts/run-browser-matrix.mjs 统一注入。
 *
 * 说明：创建页现在是一套五步向导（身份 / 个性 / 开场 / 标签 / 发布），
 * 每一步只渲染当前卡片，并且要点下一步才会进入下一段表单（每步的必填项不过就停在原地）。
 * 早先版本直接按 #identity / #persona 同屏填写，向导化之后已经跑不通，这里按向导重写。
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:18782';
const out = process.env.M2_TEST_OUT || 'artifacts/m2-roles';
await mkdir(out, {recursive: true});

const STEPS = ['identity', 'persona', 'opening', 'tags', 'publish'];

const browser = await chromium.launch();
const context = await browser.newContext({viewport: {width: 390, height: 844}, locale: 'zh-CN'});
const page = await context.newPage();
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(30000);
const check = text => {checks.push(text); console.log('PASS', text);};

/** 当前向导 step：同一时刻只有一张卡片挂载在 DOM 上。 */
async function cardId() {
  for (const id of STEPS) if (await page.locator('#' + id).count() === 1) return id;
  return null;
}
/** 逐步前进到目标卡片；每走一步都断言目标已挂载，等于顺带校验了该步的必填门禁。 */
async function goToStep(target) {
  for (let guard = 0; guard < STEPS.length + 1; guard++) {
    if (await page.locator('#' + target).count() === 1) return;
    await page.getByRole('button', {name: '下一步', exact: true}).first().click();
    await page.waitForFunction(id => !!document.querySelector('#' + id), target).catch(() => {});
  }
  throw new Error(`向导停留在 ${await cardId()}，无法前进到 ${target}`);
}
const submitButton = label => page.getByRole('button', {name: label, exact: true}).first();

try {
  // ── 1. 手机端创建私有角色（五步向导全走一遍）──────────────────────────
  const stamp = Date.now();
  const email = `m2browser${stamp}@example.com`;
  const register = await context.request.post(base + '/api/auth/register', {data: {name: '角色创作验收', email, password: 'Password123!'}});
  assert.equal(register.status(), 201, '注册失败：' + (await register.text()));
  const {token} = await register.json();
  await page.goto(base + '/discover');
  await page.evaluate(value => localStorage.setItem('xingban_token', value), token);
  await page.goto(base + '/creator');
  await page.locator('#identity').waitFor();

  const name = '原创私有角色' + stamp;
  await page.locator('#identity input').nth(0).fill(name);
  await page.locator('#identity input').nth(1).fill('一位热爱阅读的原创角色');

  await goToStep('persona');
  const persona = page.locator('#persona textarea').nth(0);
  assert.equal(await persona.getAttribute('maxlength'), '1000');
  await persona.fill('温和而耐心的图书馆管理员，喜欢分享阅读心得，会认真倾听访客的问题，保持自己的观点并尊重对方的选择，不替用户做出决定。');

  await goToStep('opening');
  await page.locator('#opening textarea').nth(0).fill('*他把书轻轻放在桌上*\n\n“今天想读什么故事？”');

  await goToStep('tags');
  await page.getByPlaceholder('搜索标签…').fill('日常');
  await page.locator('#tags').getByRole('button', {name: '日常', exact: true}).first().click();
  await page.locator('#tags header p').filter({hasText: '已选择1标签'}).waitFor();

  await goToStep('publish');
  await page.getByRole('button', {name: '预览', exact: true}).click();
  const preview = page.getByRole('dialog', {name: '角色预览'});
  await preview.waitFor();
  await preview.getByRole('button', {name: '关闭', exact: true}).last().click();
  await preview.waitFor({state: 'detached'});
  const publicSwitch = page.getByRole('switch', {name: '公开发布', exact: true});
  await publicSwitch.click();
  assert.equal(await publicSwitch.getAttribute('aria-checked'), 'false');
  await page.locator('#publish textarea').first().fill('原创测试角色，无第三方素材。');
  await submitButton('保存私有角色').click();
  await page.waitForURL(/character=/);
  const id = new URL(page.url()).searchParams.get('character');
  check('手机按向导创建、预览及保存私有角色，人设上限一致');

  // ── 2. 编辑：载入原内容 / 断网重试 / 草稿保留 ─────────────────────────
  await page.goto(base + '/my-characters');
  await page.getByRole('heading', {name, exact: true}).waitFor();
  await page.getByRole('link', {name: '编辑角色', exact: true}).click();
  await page.waitForURL(/edit=/);
  await page.waitForFunction(expected => document.querySelector('#identity input').value === expected, name);
  const edited = '编辑后的角色' + stamp;
  await page.locator('#identity input').nth(0).fill(edited);
  await page.locator('#identity input').nth(1).fill('更新简介');

  await goToStep('publish');
  await page.route('**/api/characters/' + id, route => (route.request().method() === 'PUT' ? route.abort('failed') : route.continue()));
  await submitButton('保存修改').click();
  await page.getByText('网络连接失败，草稿已保留，请重试。', {exact: true}).waitFor();
  assert(await submitButton('保存修改').isEnabled());
  await page.unroute('**/api/characters/' + id);
  await page.reload();
  await page.waitForFunction(expected => document.querySelector('#identity input').value === expected, edited);
  check('编辑载入原内容；网络失败后按钮恢复，刷新仍保留编辑草稿');

  await goToStep('publish');
  await submitButton('保存修改').click();
  await page.waitForURL(/my-characters/);
  await page.getByRole('heading', {name: edited, exact: true}).waitFor();
  check('修改后的名称与简介实际写回列表');

  // ── 3. 提交审核 → 审核放行 → 前台搜索可见 ─────────────────────────────
  await page.getByRole('button', {name: '提交审核', exact: true}).click();
  await page.getByText('待审核', {exact: true}).waitFor();
  const login = await context.request.post(base + '/api/auth/login', {data: {email: process.env.TEST_REVIEWER_EMAIL || 'reviewer@example.invalid', password: process.env.TEST_REVIEWER_PASSWORD || 'ReviewTest123!'}});
  assert.equal(login.status(), 200, '审核账号登录失败');
  const {token: reviewer} = await login.json();
  const detail = await (await context.request.get(base + '/api/characters/' + id, {headers: {Authorization: 'Bearer ' + token}})).json();
  const approved = await context.request.put(base + '/api/admin/moderation/characters/' + id, {
    headers: {Authorization: 'Bearer ' + reviewer},
    data: {status: 'APPROVED', reason: 'Browser fixture review', updatedAt: detail.character.updatedAt},
  });
  assert.equal(approved.status(), 200, '审核接口异常：' + (await approved.text()));
  await page.reload();
  await page.getByText(/^已发布/).waitFor();
  check('作品提交审核后由审核账号放行公开');
  await page.goto(base + '/discover');
  await page.getByRole('textbox', {name: '搜索角色', exact: true}).fill(edited);
  await page.locator('button[aria-haspopup="dialog"]').filter({hasText: edited}).waitFor();
  check('服务器搜索可找到刚发布角色，不受首批 50 条列表限制');

  // ── 4. 下架闭环 + 布局截图 ───────────────────────────────────────────
  await page.goto(base + '/my-characters');
  await page.getByRole('button', {name: '撤回 / 下架', exact: true}).click();
  await page.getByText('私有 / 已下架', {exact: true}).waitFor();
  assert.equal((await context.request.get(base + '/api/characters/' + id)).status(), 403);
  check('网页下架生效，匿名访问被阻断');

  for (const width of [390, 1280]) {
    await page.setViewportSize({width, height: 900});
    for (const [route, marker, file] of [['/my-characters', '我的角色', 'my-roles'], ['/creator', '#identity', 'creator']]) {
      await page.goto(base + route);
      if (marker.startsWith('#')) await page.locator(marker).waitFor();
      else await page.getByRole('heading', {name: marker, exact: true}).waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route} 横向溢出 @${width}`);
      await page.screenshot({path: path.join(out, `${file}-${width}.png`)});
    }
  }
  assert.deepEqual(errors, []);
  check('创建页与作品管理页在 390/1280px 无溢出、无网页运行错误');
} catch (error) {
  await page.screenshot({path: path.join(out, 'browser-failure.png')}).catch(() => {});
  errors.push(String(error));
  throw error;
} finally {
  await writeFile(path.join(out, 'browser-result.json'), JSON.stringify({checks, errors}, null, 2));
  await browser.close();
}
