import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = (process.env.TEST_BASE_URL || 'http://127.0.0.1:18781').replace(/\/$/, '');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));

try {
  const pageResponse = await page.goto(`${base}/shop`);
  assert.equal(pageResponse?.status(), 200, '商城页面应正常打开');
  await page.getByRole('heading', { name: '金币充值' }).waitFor();

  const packagesResponse = await page.request.get(`${base}/api/coins/packages`);
  assert.equal(packagesResponse.status(), 200, '套餐接口应正常返回');
  const checkoutEnabled = packagesResponse.headers()['x-checkout-enabled'] === 'true';
  const packages = await packagesResponse.json();
  assert.ok(Array.isArray(packages), '套餐接口继续返回数组以兼容旧调用方');

  for (const item of packages) {
    const card = page.locator('.relative.rounded-2xl').filter({ hasText: item.label }).first();
    const button = card.getByRole('button');
    await button.waitFor();
    const canPay = checkoutEnabled && Number.isSafeInteger(item.priceCnyCents) && item.priceCnyCents > 0;
    assert.equal(await button.isDisabled(), !canPay, `套餐 ${item.id} 的按钮状态应与服务端配置一致`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert(dimensions.document <= dimensions.viewport + 1, `390px 视口出现横向溢出：${JSON.stringify(dimensions)}`);
  assert.deepEqual(pageErrors, [], '页面不应有未处理的 JavaScript 错误');

  console.log(`PASS 商城页面与套餐接口；套餐 ${packages.length} 个；支付开关 ${checkoutEnabled ? '已开启' : '未开启'}`);
  console.log('PASS 按钮启用状态严格匹配服务端渠道状态和人民币价格配置');
  console.log('PASS 390px 移动视口无横向溢出，页面无未处理错误');
} finally {
  await browser.close();
}
