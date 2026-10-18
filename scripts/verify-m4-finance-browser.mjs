import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:18783';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  assert.equal((await page.request.get(`${base}/api/admin/finance/report`)).status(), 401);
  await page.goto(`${base}/admin/finance`);
  await page.getByText('请先登录财务管理员账号。', { exact: true }).waitFor();
  // UI fixtures only; actual API authorization and database invariants are tested
  // in ezfp-route-integration.test.mjs against an independent migrated database.
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'fixture', username: 'fixture', email: 'fixture@example.invalid', tier: 'FREE', coins: 0, streakCount: 0 } } }));
  await page.route('**/api/admin/session',route=>route.fulfill({json:{enabled:true,managed:true,owner:false,roles:['FINANCE_MANAGER','FINANCE_REFUND_APPROVER'],permissions:['finance.read','finance.packages.write','finance.refunds.request','finance.refunds.approve','finance.refunds.execute','finance.reconciliation.import']}}));
  await page.route('**/api/finance/callback-alerts**',route=>route.fulfill({json:{provider:'EZFP',hours:24,generatedAt:new Date().toISOString(),since:new Date(Date.now()-24*60*60*1000).toISOString(),retentionDays:30,sampling:'UI fixture sampled windows',sampledMinutes:2,reasons:[{reasonCode:'signature_or_timestamp',label:'签名或时间戳校验失败',sampledMinutes:2,firstSeenAt:new Date(Date.now()-60000).toISOString(),lastSeenAt:new Date().toISOString()}]}}));
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
  const order = { orderNo: 'REFUND-UI-ORDER', status: 'PAID', provider: 'EZFP', providerTradeNo: 'CHANNEL-REFUND-UI-ORDER', currency: 'CNY', amountCnyCents: 125, packageCoins: 100, packageBonus: 25, coinAmount: 125, createdAt: new Date().toISOString(), paidAt: new Date().toISOString(), refund: null, callbackEvents: [] };
  let orders = [];
  const actions = [];
  let outcome = 'unknown';
  const reconciliationBatch={id:'fixture-recon-batch',provider:'EZFP',importedById:'finance-fixture',importReason:'UI fixture statement',rowCount:2,matchedRowCount:1,exceptionRowCount:1,grossCnyCents:2000,feeCnyCents:50,netCnyCents:1950,periodStart:new Date(Date.now()-3600000).toISOString(),periodEnd:new Date().toISOString(),createdAt:new Date().toISOString()};
  await page.route('**/api/finance/reconciliation',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{batches:[reconciliationBatch],matchLabels:{}}});
    const requestBody=route.request().postDataJSON();assert(requestBody.csv.includes('trade_no,out_trade_no,money,fee,paid_at,status'));assert.equal(requestBody.reason,'浏览器核对渠道账单');assert.match(requestBody.periodStart,/Z$/);assert.match(requestBody.periodEnd,/Z$/);
    return route.fulfill({status:201,json:{...reconciliationBatch,created:true,duplicate:false}});
  });
  await page.route('**/api/finance/reconciliation/*',route=>route.fulfill({json:{batch:reconciliationBatch,page:1,pageSize:25,total:2,entries:[{entrySource:'STATEMENT',lineNumber:2,providerTradeNo:'FIXTURE-TRADE',orderNo:'FIXTURE-ORDER-001',grossCnyCents:1000,feeCnyCents:25,netCnyCents:975,paidAt:new Date().toISOString(),matchStatus:'MATCHED',matchLabel:'已匹配',exceptionCode:null,internalAmountCnyCents:1000,internalOrderStatus:'PAID'},{entrySource:'STATEMENT',lineNumber:3,providerTradeNo:'UNKNOWN-TRADE',orderNo:'FIXTURE-ORDER-002',grossCnyCents:1000,feeCnyCents:25,netCnyCents:975,paidAt:new Date().toISOString(),matchStatus:'ORDER_NOT_FOUND',matchLabel:'本地订单不存在',exceptionCode:'order_not_found',internalAmountCnyCents:null,internalOrderStatus:null}]}}));
  await page.route('**/api/finance/orders**', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON(); actions.push(body);
      if(body.action==='request'){
        order.status='REFUND_PENDING';order.refund={refundNo:'UI-REFUND',status:'PENDING_APPROVAL',actorId:'requester-fixture',approvedById:null,approvedAt:null,approvalReason:null,rejectedById:null,rejectedAt:null,rejectionReason:null,amountCnyCents:order.amountCnyCents,coinAmount:order.coinAmount,errorCode:null,createdAt:new Date().toISOString(),completedAt:null};
        return route.fulfill({status:201,json:order.refund});
      }
      if(body.action==='approve'&&outcome==='unknown'){
        order.status = 'REFUND_PENDING'; order.refund.status='UNKNOWN';
        return route.fulfill({ status: 502, json: { error: '渠道结果待核对。' } });
      }
      if(body.action==='verify')return route.fulfill({status:502,json:{error:'渠道结果待核对。'}});
      order.status = 'REFUNDED'; order.refund.status = 'SUCCEEDED';
      return route.fulfill({ json: { status: 'SUCCEEDED' } });
    }
    const url = new URL(request.url());
    if (url.pathname.endsWith('/all')) {
      const q = url.searchParams.get('q') || '', status = url.searchParams.get('status') || 'ALL', pageNumber = Number(url.searchParams.get('page') || 1), pageSize = Number(url.searchParams.get('pageSize') || 25);
      const filtered = orders.filter(item => (!q || item.orderNo.includes(q) || item.providerTradeNo.includes(q)) && (status === 'ALL' || item.status === status));
      return route.fulfill({ json: { page: pageNumber, pageSize, total: filtered.length, items: filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize) } });
    }
    return route.fulfill({ json: orders });
  });
  await page.route('**/api/finance/report?*', route => route.fulfill({ status: denied ? 403 : 200, json: denied ? { error: '仅财务管理员可查看。' } : report }));
  await page.evaluate(() => localStorage.setItem('xingban_token', 'ui-fixture-only'));
  await page.reload();
  await page.getByText('已付款 2 笔 · ¥2.25', { exact: true }).waitFor();
  await page.getByText(/未知成本 1 次/).waitFor();
  await page.getByRole('heading',{name:'支付回调异常（聚合）',exact:true}).waitFor();
  await page.getByText('签名或时间戳校验失败',{exact:true}).waitFor();
  await page.getByText(/FIXTURE-ORDER · PAID/).waitFor();
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
  await page.getByRole('heading',{name:'渠道账单核对',exact:true}).waitFor();
  await page.getByLabel('核对开始时间').fill('2026-10-14T00:00');
  await page.getByLabel('核对结束时间').fill('2026-10-15T00:00');
  await page.getByLabel('对账 CSV').setInputFiles({name:'statement.csv',mimeType:'text/csv',buffer:Buffer.from('trade_no,out_trade_no,money,fee,paid_at,status\nFIXTURE-TRADE,FIXTURE-ORDER-001,10.00,0.25,2026-10-14T12:00:00+08:00,PAID\n')});
  await page.getByLabel('导入原因').fill('浏览器核对渠道账单');await page.getByRole('button',{name:'导入并核对',exact:true}).click();
  await page.getByRole('status').filter({hasText:'匹配 1 笔，差异 1 笔。'}).waitFor();
  await page.getByText('本地订单不存在',{exact:false}).waitFor();
  orders = [order];
  await page.getByLabel('按订单号或渠道单号查找').fill(order.orderNo);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await page.getByText(order.orderNo, { exact: true }).waitFor();
  await page.getByLabel('按订单号查找').fill(order.orderNo);
  await page.getByRole('button', { name: '查找', exact: true }).click();
  const apply = page.getByRole('button', { name: '申请整单退款', exact: true });
  await apply.waitFor(); assert(await apply.isDisabled());
  await page.getByLabel('申请/审批/驳回理由').fill('用户申请退款');
  page.once('dialog', dialog => dialog.dismiss());
  await apply.click(); assert.equal(actions.length, 0);
  page.once('dialog', dialog => dialog.accept());
  await apply.click();
  await page.getByRole('status').filter({hasText:'待审批'}).waitFor();
  assert.deepEqual(actions[0], { action: 'request', reason: '用户申请退款' });
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'批准并提交渠道',exact:true}).click();
  await page.getByRole('alert').filter({ hasText: '渠道结果待核对。' }).waitFor();
  assert.equal(actions[1].action,'approve');
  await page.getByRole('button', { name: '查询退款状态', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '渠道结果待核对。' }).waitFor();
  assert.equal(actions[2].action, 'verify');
  outcome = 'success';
  await page.getByRole('button', { name: '同退款单号重试', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '退款成功' }).waitFor();
  assert.equal(actions[3].action, 'retry');
  assert.equal(await page.getByRole('button', { name: '同退款单号重试', exact: true }).count(), 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  denied = true;
  await page.getByRole('button', { name: '刷新', exact: true }).first().click();
  await page.getByRole('alert').filter({ hasText: '仅财务管理员可查看。' }).waitFor();
  assert.equal(await page.getByText(/FIXTURE-ORDER · PAID/).count(), 0, '拒绝访问后必须清除旧报告');
  assert.deepEqual(errors, []);
  console.log('PASS 匿名接口 401；套餐创建/活动编辑/并发冲突；预算与未知成本提示；回调异常摘要；渠道账单导入/差异；退款申请/二人审批/拒绝/结果未知保留/查单/重试成功；390px 布局；权限拒绝清空（UI 使用明确模拟数据）');
} finally { await browser.close(); }
