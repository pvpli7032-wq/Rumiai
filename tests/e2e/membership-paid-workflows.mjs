import {strict as assert} from 'node:assert';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';
import {generateKeyPairSync} from 'node:crypto';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
if (process.env.DATABASE_URL) throw Error('E2E refuses an external DATABASE_URL; it owns its isolated fixture.');
process.env.PAYMENT_MERCHANT_ENCRYPTION_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const root = fileURLToPath(new URL('../..', import.meta.url));
const children = [];
let fixture;
let browser;

function start(app, port, env) {
  const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)], {
    cwd: path.join(root, 'apps', app), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  const record = {child, closed, output: ''};
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { record.output += data.toString(); });
  children.push(record);
}

async function stopChildren() {
  await Promise.all(children.map(async ({child, closed}) => {
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore', windowsHide: true}); }
        catch { if (child.exitCode === null) child.kill(); }
      } else child.kill('SIGTERM');
    }
    let timer;
    try {
      await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`service ${child.pid} did not close`)), 8000); })]);
    } finally { clearTimeout(timer); }
  }));
}

async function waitForService(url) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const failed = children.find(({child}) => child.exitCode !== null || child.signalCode !== null);
    if (failed) throw Error(`test service exited: ${failed.output}`);
    try { if ((await fetch(url, {signal: AbortSignal.timeout(2000)})).status < 500) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error(`service not ready: ${url}`);
}

async function seedMemberships() {
  const {db, user} = fixture;
  const {encryptSecretParts} = await import('@rumiai/backend/modules/payments/merchant-credentials');
  const {createMembershipOrder, markMembershipPaid} = await import('@rumiai/backend/modules/memberships/service');
  await db.user.update({where: {id: user.id}, data: {coins: 1000}});
  await db.membershipPolicy.upsert({where: {id: 'primary'}, create: {id: 'primary', refundWindowHours: 24, usageChargePeriodHours: 24}, update: {refundWindowHours: 24, usageChargePeriodHours: 24}});
  const plan = await db.membershipPlan.update({where: {code: 'MONTHLY'}, data: {
    name: 'E2E 已购月会员', priceCents: 3000, isActive: true,
    benefitsJson: JSON.stringify([{key: 'CHAT_PRICE_MULTIPLIER', label: '聊天收费倍率', value: 0.8}]),
  }});
  const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  const merchantPrivateKey = privateKey.export({type: 'pkcs1', format: 'pem'}).toString();
  const platformPublicKey = publicKey.export({type: 'pkcs1', format: 'pem'}).toString();
  const merchant = await db.paymentMerchant.create({data: {id: 'e2e-paid-merchant', name: 'E2E 已购会员测试商户', provider: 'EZFP', environment: 'PRODUCTION', isActive: false, version: 1}});
  const revision = await db.paymentMerchantRevision.create({data: {merchantId: merchant.id, revision: 1, merchantNo: '10001', apiBaseUrl: 'http://127.0.0.1:9', refundsEnabled: false, createdBy: fixture.admin.id, ...encryptSecretParts(merchantPrivateKey, platformPublicKey)}});
  await db.paymentMerchant.update({where: {id: merchant.id}, data: {currentRevisionId: revision.id}});
  const revisionId = revision.id;
  async function paidOrder(label, paidAt) {
    const payment = await db.paymentOrder.create({data: {orderNo: `E2EPAY${label}`, idempotencyKey: `e2e-pay-${label}`, userId: user.id, packageCoins: 0, packageBonus: 0, coinAmount: 0, amountCnyCents: plan.priceCents, status: 'PAID', merchantRevisionId: revisionId, providerTradeNo: `E2E-TRADE-${label}`, paidAt}});
    const order = await createMembershipOrder({userId: user.id, planCode: 'MONTHLY', idempotencyKey: `e2e-membership-${label}`, orderNo: `E2EMEMBER${label}`, paymentOrderId: payment.id});
    await markMembershipPaid(order.orderNo, paidAt);
    return order;
  }
  const now = Date.now();
  const expired = await paidOrder('EXPIRED', new Date(now - 31 * 86400000));
  const used = await paidOrder('USED', new Date(now - 3600000));
  const renewal = await paidOrder('RENEWAL', new Date(now - 3600000));
  const provider = await db.aiProvider.create({data: {name: 'e2e-paid-provider', baseUrl: 'http://127.0.0.1:9'}});
  const model = await db.aiModel.create({data: {key: 'e2e-paid-model', displayName: 'E2E Paid', modelCode: 'e2e-paid', providerId: provider.id, isActive: true, isDefault: true}});
  await db.modelCoinPrice.create({data: {modelId: model.id, coinsPerReply: 100, effectiveAt: new Date(now - 1000), createdBy: user.id}});
  for (const [key, value] of Object.entries({'billing.chargingEnabled': true, 'billing.freeDailyMessages': 0, 'billing.dayTimezone': 'UTC', 'billing.priceMultiplier': 1000})) {
    await db.operationSetting.upsert({where: {key}, create: {key, group: 'billing', value: JSON.stringify(value), updatedBy: user.id}, update: {value: JSON.stringify(value), updatedBy: user.id}});
  }
  const {holdCharge, settleCharge} = await import('@rumiai/backend/modules/billing/charge-service');
  const {quoteReplyPrice} = await import('@rumiai/backend/modules/billing/price');
  const requestId = `e2e-paid-hold-${used.id}`;
  const quote = await quoteReplyPrice({userId: user.id, operation: 'CHAT_SEND', modelKey: model.key});
  if (quote.coins !== 80) throw Error(`unexpected billing quote: ${JSON.stringify(quote)}`);
  const held = await holdCharge({userId: user.id, requestId, operation: 'CHAT_SEND', modelKey: model.key, requestContent: 'isolated paid membership E2E'});
  assert.equal(held.coins, 80);
  await settleCharge({userId: user.id, requestId, operation: 'CHAT_SEND'});
  return {expired, used, renewal, user, password: fixture.password};
}

try {
  fixture = await createFixture();
  const seeded = await seedMemberships();
  await fixture.disconnect();
  const env = {...process.env,
    DATABASE_URL: `file:${fixture.dbPath.replaceAll('\\', '/')}`,
    BACKUPS_DIRECTORY: path.join(fixture.dir, 'backups'), UPLOADS_DIRECTORY: path.join(fixture.dir, 'uploads'),
    INTERNAL_API_ORIGIN: 'http://127.0.0.1:3012', ADMIN_API_INTERNAL_URL: 'http://127.0.0.1:3012',
    NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'production', JWT_SECRET: 'e2e-only-jwt-secret-012345678901234567890123',
    NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3010', ADMIN_PUBLIC_ORIGIN: 'http://127.0.0.1:3011',
    PAYMENT_MERCHANT_ENCRYPTION_KEY: process.env.PAYMENT_MERCHANT_ENCRYPTION_KEY,
    EZFP_ENABLED: 'false', EZFP_REFUNDS_ENABLED: 'false', EZFP_PID: '', EZFP_MERCHANT_PRIVATE_KEY: '', EZFP_PLATFORM_PUBLIC_KEY: '',
    AI_API_KEY: '', OPENAI_API_KEY: '',
  };
  start('api', 3012, env); start('web', 3010, env);
  await waitForService('http://127.0.0.1:3010/login');
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  const login = await page.request.post('http://127.0.0.1:3010/api/auth/login', {data: {email: seeded.user.email, password: seeded.password}});
  assert.equal(login.status(), 200);
  const {token} = await login.json();
  const fullQuote = await page.request.get(`http://127.0.0.1:3010/api/me/membership/refund-preview?orderNo=${seeded.renewal.orderNo}`, {headers: {Authorization: `Bearer ${token}`} });
  assert.equal(fullQuote.status(), 200); assert.equal((await fullQuote.json()).amountCents, 3000);
  const usedQuote = await page.request.get(`http://127.0.0.1:3010/api/me/membership/refund-preview?orderNo=${seeded.used.orderNo}`, {headers: {Authorization: `Bearer ${token}`} });
  const usedQuoteBody = await usedQuote.json();
  assert.equal(usedQuote.status(), 200); assert.equal(usedQuoteBody.deductedCents, 100); assert.equal(usedQuoteBody.amountCents, 2900);
  await page.goto('http://127.0.0.1:3010/login');
  await page.getByLabel(/邮箱/).fill(seeded.user.email); await page.getByRole('textbox', {name: '密码'}).fill(seeded.password);
  const loginResponse = page.waitForResponse(r => r.url().includes('/api/auth/login') && r.request().method() === 'POST');
  await page.getByRole('button', {name: /登录/}).click(); assert.equal((await loginResponse).status(), 200);
  await page.goto('http://127.0.0.1:3010/membership');
  await page.getByText('当前会员：E2E 已购月会员', {exact: true}).waitFor();
  await page.getByText('含续费有效期至', {exact: false}).waitFor();
  await page.getByText('购买与续费记录', {exact: true}).waitFor();
  assert.equal(await page.getByRole('button', {name: '手动续费'}).count(), 1);
  const refundButtons = page.getByRole('button', {name: '查看退款金额'});
  assert.equal(await refundButtons.count(), 3);
  let dialogMessage = '';
  let refundPosts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/me/membership/refund')) refundPosts++; });
  const unusedDialog = new Promise(resolve => page.once('dialog', async dialog => { dialogMessage = dialog.message(); await dialog.dismiss(); resolve(); }));
  await refundButtons.nth(0).click();
  await unusedDialog;
  assert.match(dialogMessage, /退款金额 ¥30\.00/); assert.match(dialogMessage, /使用权益扣费 ¥0\.00/); assert.equal(refundPosts, 0);
  await page.reload();
  await page.getByText('购买与续费记录', {exact: true}).waitFor();
  const refreshedRefundButtons = page.getByRole('button', {name: '查看退款金额'});
  let failedRefundStatus;
  let failedRefundBody;
  page.on('response', response => { if (response.request().method() === 'POST' && response.url().endsWith('/api/me/membership/refund')) { failedRefundStatus = response.status(); void response.json().then(body => { failedRefundBody = body; }).catch(() => undefined); } });
  let usedDialogMessage = '';
  const usedDialog = new Promise(resolve => page.once('dialog', async dialog => { usedDialogMessage = dialog.message(); await dialog.accept(); resolve(); }));
  await refreshedRefundButtons.nth(1).click();
  await usedDialog;
  assert.match(usedDialogMessage, /退款金额 ¥29\.00/); assert.match(usedDialogMessage, /使用权益扣费 ¥1\.00/);
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(failedRefundStatus, 503);
  assert.equal(failedRefundBody?.code, 'REFUNDS_DISABLED');
  await new Promise(resolve => setTimeout(resolve, 500));
  const visibleBody = await page.locator('body').innerText();
  if (!visibleBody.includes('退款功能尚未启用')) throw Error(`refund error not rendered:\n${visibleBody.slice(-2500)}`);
  assert.equal(await page.getByText('退款已确认，会员有效期已更新。', {exact: true}).count(), 0);
  const afterFailure = await page.request.get('http://127.0.0.1:3010/api/me/membership', {headers: {Authorization: `Bearer ${token}`} });
  const afterBody = await afterFailure.json();
  const usedAfter = afterBody.orders.find(order => order.orderNo === seeded.used.orderNo);
  assert.equal(usedAfter.status, 'PAID'); assert.equal(usedAfter.grant.status, 'ACTIVE'); assert.equal(usedAfter.refund, null);
  console.log(JSON.stringify({login: true, currentMembership: true, renewalProjection: true, paidOrders: true, manualRenewal: true, unusedRefundQuote: true, usedRefundQuote: true, cancelDoesNotPost: true, refundsDisabled503: true, grantPreserved: true}));
} finally {
  try { await browser?.close(); }
  finally { try { await stopChildren(); } finally { await fixture?.cleanup(); } }
}
