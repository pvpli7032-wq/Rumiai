import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:18783';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  assert.equal((await page.request.get(`${base}/api/finance/report`)).status(), 401);
  await page.goto(`${base}/finance`);
  await page.getByText('请先登录财务管理员账号。', { exact: true }).waitFor();
  // UI fixtures only; actual API authorization and database invariants are tested
  // in ezfp-route-integration.test.mjs against an independent migrated database.
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'fixture', username: 'fixture', email: 'fixture@example.invalid', tier: 'FREE', coins: 0, streakCount: 0 } } }));
  const report = {
    days: 7, since: new Date().toISOString(), generatedAt: new Date().toISOString(), paidOrders: 2, paidAmountCnyCents: 225,
    orderAnomalies: [{ orderNo: 'FIXTURE-ORDER', userId: 'fixture', status: 'PAID', expectedCoins: 50, actualCoins: null }],
    orderAnomaliesTruncated: false, refundAnomalies: [], refundAnomaliesTruncated: false, completedRefunds: 1, refundedAmountCnyCents: 125, netAfterRefundsCnyCents: 100,
    negativeBalances: [{ id: 'fixture-negative', coins: -1 }], negativeBalancesTruncated: false,
    aiCosts: [{ currency: 'USD', calls: 3, knownCostCalls: 1, unknownCostCalls: 1, estimatedCost: 0.2, failedCalls: 1, mockCalls: 1, realCalls: 2, costPerThousandCalls: null }, { currency: 'CNY', calls: 1, knownCostCalls: 1, unknownCostCalls: 0, estimatedCost: 1.5, failedCalls: 0, mockCalls: 0, realCalls: 1, costPerThousandCalls: 1500 }],
    validationMetrics: { registeredUsers: 4, payingNewUsers: 1, paidOrderCount: 2, refundedCohortOrders: 1, newUserPaymentRate: 0.25, paidOrderRefundRate: 0.5, grossMarginRate: null },
    aiBudget: { status: 'enabled', timezone: 'UTC', since: new Date().toISOString(), budgets: { USD: { site: 0.1 } }, alerts: [{ scope: 'site', currency: 'USD', userId: null, knownCost: 0.2, budget: 0.1 }], alertsTruncated: false, unknownCostCalls: 1, unbudgetedCurrencies: [] },
  };
  let denied = false;
  const managedPackages = [];
  let packageConflict = false;
  const savedPackages = [];
  await page.route('**/api/finance/packages**', async route => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { packages: managedPackages, changes: [] } });
    const body = req.postDataJSON();
    if (packageConflict) return route.fulfill({ status: 409, json: { error: '套餐已被其他操作修改，请刷新后重新编辑。' } });
    savedPackages.push(body);
    const item = { ...body, id: 'ui-package', version: req.method() === 'POST' ? 0 : 1, effectiveBonus: body.bonus };
    managedPackages.splice(0, managedPackages.length, item);
    return route.fulfill({ status: req.method() === 'POST' ? 201 : 200, json: item });
  });
  const order = { orderNo: 'REFUND-UI-ORDER', status: 'PAID', provider: 'EZFP', amountCnyCents: 125, coinAmount: 125, refund: null };
  let orders = [];
  const actions = [];
  let outcome = 'unknown';
  await page.route('**/api/finance/orders**', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON(); actions.push(body);
      if (outcome === 'unknown') {
        order.status = 'REFUND_PENDING'; order.refund = { refundNo: 'UI-REFUND', status: 'UNKNOWN' };
        return route.fulfill({ status: 502, json: { error: '渠道结果待核对。' } });
      }
      order.status = 'REFUNDED'; order.refund.status = 'SUCCEEDED';
      return route.fulfill({ json: { status: 'SUCCEEDED' } });
    }
    return route.fulfill({ json: orders });
  });
  await page.route('**/api/finance/report?*', route => route.fulfill({ status: denied ? 403 : 200, json: denied ? { error: '仅财务管理员可查看。' } : report }));
  await page.evaluate(() => localStorage.setItem('khuiai_token', 'ui-fixture-only'));
  await page.reload();
  await page.getByText('已付款 2 笔 · ¥2.25', { exact: true }).waitFor();
  await page.getByText(/未知成本 1 次/).waitFor();
  await page.getByText(/FIXTURE-ORDER/).waitFor();
  await page.getByLabel('按订单号查找').waitFor();
  await page.getByText('暂无可退款订单。', { exact: true }).waitFor();
  await page.getByRole('alert').filter({ hasText: '达到预算 0.1' }).waitFor();
  await page.getByText('当日 1 次调用成本未知，无法确认是否超预算。', { exact: true }).waitFor();
  await page.getByText('新注册用户付费率：25.00%（1 / 4 人）', { exact: true }).waitFor();
  await page.getByText('付款订单退款率：50.00%（1 / 2 笔）', { exact: true }).waitFor();
  await page.getByText('USD · 每千次 AI 调用成本：无法计算（2 次非模拟调用）', { exact: true }).waitFor();
  await page.getByText('CNY · 每千次 AI 调用成本：1500.000000（1 次非模拟调用）', { exact: true }).waitFor();
  await page.getByLabel('套餐名称', { exact: true }).fill('浏览器套餐');
  await page.getByLabel('人民币价格（元）', { exact: true }).fill('6');
  await page.getByLabel('基础金币', { exact: true }).fill('60');
  await page.getByRole('button', { name: '保存套餐', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '套餐已保存' }).waitFor();
  assert.equal(savedPackages[0].priceCnyCents, 600);
  assert.equal(savedPackages[0].coins, 60);
  await page.getByRole('button', { name: '编辑 浏览器套餐', exact: true }).click();
  await page.getByLabel('赠送金币', { exact: true }).fill('6');
  await page.getByLabel('活动开始', { exact: true }).fill('2030-01-01T10:00');
  await page.getByLabel('活动结束', { exact: true }).fill('2030-01-02T10:00');
  await page.getByRole('button', { name: '保存套餐', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '套餐已保存' }).waitFor();
  assert.equal(savedPackages[1].bonus, 6);
  assert.match(savedPackages[1].bonusStartsAt, /Z$/);
  await page.getByRole('button', { name: '编辑 浏览器套餐', exact: true }).click();
  packageConflict = true;
  await page.getByRole('button', { name: '保存套餐', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '套餐已被其他操作修改' }).waitFor();
  assert.equal(savedPackages.length, 2);
  orders = [order];
  await page.getByLabel('按订单号查找').fill(order.orderNo);
  await page.getByRole('button', { name: '查找', exact: true }).click();
  const apply = page.getByRole('button', { name: '申请整单退款', exact: true });
  await apply.waitFor(); assert(await apply.isDisabled());
  await page.getByLabel('退款原因').fill('用户申请退款');
  page.once('dialog', dialog => dialog.dismiss());
  await apply.click(); assert.equal(actions.length, 0);
  page.once('dialog', dialog => dialog.accept());
  await apply.click();
  await page.getByRole('alert').filter({ hasText: '渠道结果待核对。' }).waitFor();
  assert.deepEqual(actions[0], { action: 'refund', reason: '用户申请退款' });
  await page.getByRole('button', { name: '查询退款状态', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '渠道结果待核对。' }).waitFor();
  assert.equal(actions[1].action, 'verify');
  outcome = 'success';
  await page.getByRole('button', { name: '同退款单号重试', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '退款成功' }).waitFor();
  assert.equal(actions[2].action, 'retry');
  assert.equal(await page.getByRole('button', { name: '同退款单号重试', exact: true }).count(), 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  denied = true;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '仅财务管理员可查看。' }).waitFor();
  assert.equal(await page.getByText(/FIXTURE-ORDER/).count(), 0, '拒绝访问后必须清除旧报告');
  assert.deepEqual(errors, []);
  console.log('PASS 匿名接口 401；套餐创建/活动编辑/并发冲突；预算与未知成本提示；退款原因/取消/未知结果错误保留/查单/重试成功；390px 布局；权限拒绝清空（UI 使用明确模拟数据）');
} finally { await browser.close(); }
