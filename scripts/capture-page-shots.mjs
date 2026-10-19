/**
 * 第 8 章自测的截图留证：同一批页面在 390px 与 1280px 各留一张图，并顺带断言没有横向溢出、
 * 没有未捕获的 JS 异常。
 *
 * 与其他 verify-* 脚本一样，本脚本不起服务，需要 TEST_BASE_URL（由
 * scripts/run-browser-matrix.mjs 提供隔离实例）。
 *
 * 覆盖范围刻意限定为匿名可访问的公开页面；需要登录态的页面由别的脚本各自适应自分 widths：
 * - 创建页 / 作品管理：test:m2:browser（390 与 1280）
 * - 后台三页：test:admin:browser（360 / 390 / 768 / 1280）
 * - 对话区：test:m1:mobile（360 / 390 / 430）
 */
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:18782';
const out = process.env.SHOTS_TEST_OUT || 'artifacts/page-shots';
await mkdir(out, {recursive: true});

const ROUTES = [
  ['/', 'landing'],
  ['/discover', 'discover'],
  ['/circles', 'circles'],
  ['/shop', 'shop'],
  ['/creator', 'creator'],
  ['/login', 'login'],
  ['/register', 'register'],
];
const WIDTHS = [390, 1280];

const browser = await chromium.launch();
const checks = [], errors = [], shots = [];
try {
  for (const width of WIDTHS) {
    const context = await browser.newContext({viewport: {width, height: width === 390 ? 844 : 900}, locale: 'zh-CN'});
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${width}px: ${error.message}`));
    for (const [route, slug] of ROUTES) {
      await page.goto(base + route, {waitUntil: 'load'});
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.evaluate(() => document.readyState === 'complete');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 1, `${route} 在 ${width}px 横向溢出 ${overflow}px`);
      const file = `${slug}-${width}.png`;
      await page.screenshot({path: path.join(out, file)});
      shots.push(file);
    }
    await context.close();
    checks.push(`${width}px 七个公开页面截图完成，无横向溢出`);
    console.log('PASS', checks.at(-1));
  }
  assert.deepEqual(errors, [], '页面抛出未捕获异常');
  console.log('PASS 全部页面无未捕获 JS 异常');
} finally {
  await writeFile(path.join(out, 'result.json'), JSON.stringify({checks, shots, errors}, null, 2));
  await browser.close();
}
