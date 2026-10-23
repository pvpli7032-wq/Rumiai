import {strict as assert} from 'node:assert';
import {createRequire} from 'node:module';

if (process.env.SERVER_ACCEPTANCE_ENABLED !== '1') throw new Error('Refusing server acceptance: set SERVER_ACCEPTANCE_ENABLED=1 explicitly.');
let account;
try { account = JSON.parse(process.env.SERVER_ACCEPTANCE_ACCOUNT_JSON || ''); }
catch { throw new Error('SERVER_ACCEPTANCE_ACCOUNT_JSON must be valid JSON.'); }
if (!account || typeof account !== 'object' || typeof account.email !== 'string' || typeof account.password !== 'string' || typeof account.userId !== 'string') {
  throw new Error('SERVER_ACCEPTANCE_ACCOUNT_JSON must contain email, password, and userId.');
}
const configuredOrigin = process.env.SERVER_ACCEPTANCE_ORIGIN?.trim();
if (!configuredOrigin) throw new Error('SERVER_ACCEPTANCE_ORIGIN is required for live configuration acceptance.');
let origin;
try { origin = new URL(configuredOrigin).origin; }
catch { throw new Error('SERVER_ACCEPTANCE_ORIGIN must be a valid http(s) origin.'); }
if (!/^https?:$/.test(new URL(origin).protocol)) throw new Error('SERVER_ACCEPTANCE_ORIGIN must use http or https.');

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const prices = {MONTHLY: 3000, QUARTERLY: 8000, YEARLY: 28000};
const rights = {MONTHLY: 7, QUARTERLY: 8, YEARLY: 9};
const multipliers = {MONTHLY: 0.8, QUARTERLY: 0.7, YEARLY: 0.6};
let browser;
let admin;
let front;
let original;
let result;

async function readMemberships() {
  const response = await admin.request.get(`${origin}/api/admin/memberships`);
  assert.equal(response.status(), 200);
  return response.json();
}

async function patchMembership(body) {
  const response = await admin.request.patch(`${origin}/api/admin/memberships`, {data: body});
  if (response.status() !== 200) throw Error(`membership config write failed (${response.status()})`);
  return response.json();
}

async function restoreOriginal() {
  const latest = await readMemberships();
  const policy = await patchMembership({...original.policy, kind: 'policy', version: latest.policy.version, reason: '服务器验收恢复原会员退款参数'});
  assert.equal(policy.refundWindowHours, original.policy.refundWindowHours);
  assert.equal(policy.usageChargePeriodHours, original.policy.usageChargePeriodHours);
  let current = await readMemberships();
  for (const plan of original.plans) {
    const currentPlan = current.plans.find(item => item.id === plan.id);
    if (!currentPlan) throw Error(`cannot restore missing membership plan ${plan.code}`);
    await patchMembership({...plan, version: currentPlan.version, reason: '服务器验收恢复原会员套餐参数'});
    current = await readMemberships();
  }
}

async function assertOriginalRestored() {
  const restored = await readMemberships();
  assert.equal(restored.policy.refundWindowHours, original.policy.refundWindowHours);
  assert.equal(restored.policy.usageChargePeriodHours, original.policy.usageChargePeriodHours);
  for (const expected of original.plans) {
    const actual = restored.plans.find(item => item.id === expected.id);
    assert.ok(actual, `restored plan missing: ${expected.code}`);
    for (const key of ['code', 'name', 'durationDays', 'priceCents', 'isActive', 'sortOrder']) assert.deepEqual(actual[key], expected[key]);
    assert.deepEqual(actual.benefits, expected.benefits);
  }
  const publicResponse = await front.request.get(`${origin}/api/memberships`);
  assert.equal(publicResponse.status(), 200);
  const publicRestored = await publicResponse.json();
  const expectedPublic = original.plans.filter(plan => plan.isActive && plan.priceCents !== null && plan.priceCents > 0);
  const expectedPublicIds = expectedPublic.map(plan => plan.id).sort();
  assert.deepEqual(publicRestored.plans.map(plan => plan.id).sort(), expectedPublicIds);
  for (const expected of expectedPublic) {
    const actual = publicRestored.plans.find(item => item.id === expected.id);
    assert.ok(actual, `restored public plan missing: ${expected.code}`);
    for (const key of ['code', 'name', 'durationDays', 'priceCents', 'isActive', 'sortOrder']) assert.deepEqual(actual[key], expected[key]);
    assert.deepEqual(actual.benefits, expected.benefits);
  }
}

let primaryFailure;
const cleanupFailures = [];
try {
  browser = await chromium.launch({headless: true});
  admin = await browser.newPage();
  front = await browser.newPage();

  await admin.goto(`${origin}/admin/login`);
  await admin.getByLabel('登录邮箱').fill(account.email);
  await admin.getByLabel('密码').fill(account.password);
  const login = admin.waitForResponse(response => response.url().includes('/api/admin/auth/login') && response.request().method() === 'POST');
  await admin.getByRole('button', {name: '登录管理中心'}).click();
  assert.equal((await login).status(), 200);
  await admin.waitForURL('**/admin');

  original = await readMemberships();
  assert.ok(Array.isArray(original.plans));
  for (const code of Object.keys(prices)) assert.ok(original.plans.some(plan => plan.code === code), `missing configured plan ${code}`);

  await admin.goto(`${origin}/admin/memberships`);
  await admin.getByText(/会员方案/).first().waitFor();
  await admin.getByLabel('退款窗口（小时）').fill('23');
  await admin.getByLabel('使用后扣费周期（小时）').fill('12');

  for (const plan of original.plans) {
    if (!(plan.code in prices)) continue;
    const panel = admin.locator('section').filter({has: admin.getByRole('heading', {name: plan.name, exact: true})}).first();
    await panel.getByLabel('价格（分）').fill(String(prices[plan.code]));
    await panel.getByLabel('前台开放购买').check();
    const benefits = panel.locator('fieldset').filter({hasText: '可执行权益'}).first();
    const dailyBlock = benefits.locator('div.rounded.border').first();
    const dailyToggle = dailyBlock.getByRole('checkbox').first();
    if (!(await dailyToggle.isChecked())) await dailyToggle.check();
    await dailyBlock.locator('input[type=number]').fill(String(rights[plan.code]));
    const multiplierBlock = benefits.locator('div.rounded.border').nth(1);
    const multiplierToggle = multiplierBlock.getByRole('checkbox').first();
    if (!(await multiplierToggle.isChecked())) await multiplierToggle.check();
    await multiplierBlock.locator('input[type=number]').fill(String(multipliers[plan.code]));
  }
  await admin.getByRole('button', {name: '保存配置'}).click();
  await admin.getByText('已保存，前台将读取最新方案。', {exact: true}).waitFor();

  const changed = await readMemberships();
  assert.equal(changed.policy.refundWindowHours, 23);
  assert.equal(changed.policy.usageChargePeriodHours, 12);
  const changedByCode = new Map(changed.plans.map(plan => [plan.code, plan]));
  assert.deepEqual([...changedByCode.keys()].filter(code => code in prices).sort(), Object.keys(prices).sort());
  for (const code of Object.keys(prices)) {
    const plan = changedByCode.get(code);
    assert.ok(plan);
    assert.equal(plan.priceCents, prices[plan.code]);
    assert.equal(plan.benefits.find(item => item.key === 'DAILY_FREE_REPLIES')?.value, rights[plan.code]);
    assert.equal(plan.benefits.find(item => item.key === 'CHAT_PRICE_MULTIPLIER')?.value, multipliers[plan.code]);
    assert.equal(plan.isActive, true);
  }

  const publicCatalog = await front.request.get(`${origin}/api/memberships`);
  assert.equal(publicCatalog.status(), 200);
  const publicBody = await publicCatalog.json();
  const publicByCode = new Map(publicBody.plans.map(plan => [plan.code, plan]));
  assert.deepEqual([...publicByCode.keys()].filter(code => code in prices).sort(), Object.keys(prices).sort());
  for (const code of Object.keys(prices)) {
    const plan = publicByCode.get(code);
    assert.ok(plan);
    assert.equal(plan.priceCents, prices[plan.code]);
    assert.equal(plan.benefits.find(item => item.key === 'DAILY_FREE_REPLIES')?.value, rights[plan.code]);
    assert.equal(plan.benefits.find(item => item.key === 'CHAT_PRICE_MULTIPLIER')?.value, multipliers[plan.code]);
    assert.equal(plan.isActive, true);
  }
  const membershipPage = await front.goto(`${origin}/membership`);
  assert.ok(membershipPage && membershipPage.status() < 500);
  for (const code of Object.keys(prices)) {
    const plan = publicByCode.get(code);
    assert.ok(plan);
    await front.getByRole('heading', {name: plan.name, exact: true}).waitFor();
    await front.getByText(`¥${(prices[plan.code] / 100).toFixed(2)}`, {exact: true}).waitFor();
    await front.getByText(`${rights[plan.code]} 次/日`, {exact: true}).waitFor();
    await front.getByText(`${multipliers[plan.code]} 倍`, {exact: true}).waitFor();
  }
  result = {enabled: true, adminLogin: true, originalRead: true, uiSaved: true, policyApplied: true, pricesApplied: true, dailyFreeRepliesApplied: true, chatPriceMultiplierApplied: true, publicApiLinked: true, frontendLinked: true, characterCreateLimitTested: false, paymentUntouched: true};
} catch (error) {
  primaryFailure = error;
} finally {
  try {
    if (original && admin) await restoreOriginal();
    if (original && admin && front) await assertOriginalRestored();
  } catch (error) {
    cleanupFailures.push(error);
  } finally {
    try { await browser?.close(); } catch (error) { cleanupFailures.push(error); }
  }
}
if (primaryFailure || cleanupFailures.length) {
  const failures = [primaryFailure, ...cleanupFailures].filter(Boolean);
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, 'membership configuration acceptance and/or restoration failed');
}
console.log(JSON.stringify({...result, restored: true}));
