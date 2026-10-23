import {strict as assert} from 'node:assert';
import {createRequire} from 'node:module';

if (process.env.SERVER_ACCEPTANCE_ENABLED !== '1') {
  throw new Error('Refusing server acceptance: set SERVER_ACCEPTANCE_ENABLED=1 explicitly.');
}

let account;
try { account = JSON.parse(process.env.SERVER_ACCEPTANCE_ACCOUNT_JSON || ''); }
catch { throw new Error('SERVER_ACCEPTANCE_ACCOUNT_JSON must be valid JSON.'); }
if (!account || typeof account !== 'object' || typeof account.email !== 'string' || typeof account.password !== 'string' || typeof account.userId !== 'string') {
  throw new Error('SERVER_ACCEPTANCE_ACCOUNT_JSON must contain email, password, and userId.');
}

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const configuredOrigin = process.env.SERVER_ACCEPTANCE_ORIGIN?.trim();
let publicOrigin = null;
if (configuredOrigin) {
  try { publicOrigin = new URL(configuredOrigin).origin; }
  catch { throw new Error('SERVER_ACCEPTANCE_ORIGIN must be a valid http(s) origin.'); }
  if (!/^https?:$/.test(new URL(publicOrigin).protocol)) throw new Error('SERVER_ACCEPTANCE_ORIGIN must use http or https.');
}
const webOrigin = publicOrigin || 'http://127.0.0.1:3310';
const adminOrigin = publicOrigin || 'http://127.0.0.1:3311';
const apiOrigin = publicOrigin || 'http://127.0.0.1:3312';
let browser;

try {
  browser = await chromium.launch({headless: true});
  const admin = await browser.newPage();
  const front = await browser.newPage();
  const result = {
    enabled: true,
    adminLogin: false,
    sidebarPersistence: false,
    membershipReadOnly: false,
    accountScoped: false,
    profileFormSave: false,
    profileApiPropagation: false,
    profileDomPropagation: false,
    adminCookieCannotUseFrontend: false,
    frontendBearerCannotUseAdmin: false,
  };

  await admin.goto(`${adminOrigin}/admin/login`);
  await admin.getByLabel('登录邮箱').fill(account.email);
  await admin.getByLabel('密码').fill(account.password);
  const adminLoginResponse = admin.waitForResponse(response => response.url().includes('/api/admin/auth/login') && response.request().method() === 'POST');
  await admin.getByRole('button', {name: '登录管理中心'}).click();
  assert.equal((await adminLoginResponse).status(), 200);
  await admin.waitForURL('**/admin');
  result.adminLogin = true;

  await admin.goto(`${adminOrigin}/admin/accounts`);
  await admin.getByTitle('收起侧栏').click();
  assert.equal(await admin.evaluate(() => localStorage.getItem('admin.sidebar.collapsed')), '1');
  await admin.reload();
  assert.equal(await admin.evaluate(() => localStorage.getItem('admin.sidebar.collapsed')), '1');
  result.sidebarPersistence = true;

  const membershipPage = await admin.goto(`${adminOrigin}/admin/memberships`);
  assert.ok(membershipPage && membershipPage.status() < 500);
  await admin.getByText(/会员|套餐/).first().waitFor();
  const membershipRead = await admin.request.get(`${adminOrigin}/api/admin/memberships`);
  assert.equal(membershipRead.status(), 200);
  // This is intentionally read-only: the server's configured plans and nullable prices are not changed.
  result.membershipReadOnly = true;

  const frontMembershipPage = await front.goto(`${webOrigin}/membership`);
  assert.ok(frontMembershipPage && frontMembershipPage.status() < 500);
  const publicMembership = await front.request.get(`${webOrigin}/api/memberships`);
  assert.equal(publicMembership.status(), 200);
  const publicMembershipBody = await publicMembership.json();
  assert.ok(Array.isArray(publicMembershipBody.plans));
  assert.ok(publicMembershipBody.plans.every(plan => plan.priceCents === null || (Number.isSafeInteger(plan.priceCents) && plan.priceCents >= 1)), 'public membership must not expose a fake zero price');

  await admin.goto(`${adminOrigin}/admin/accounts`);
  const accountsResponse = await admin.request.get(`${adminOrigin}/api/admin/accounts?q=${encodeURIComponent(account.email)}`);
  assert.equal(accountsResponse.status(), 200);
  const accountsBody = await accountsResponse.json();
  const target = accountsBody.items?.find(user => user.id === account.userId);
  assert.ok(target, 'the supplied acceptance account must be present in the admin account list');
  assert.equal(target.email, account.email, 'the supplied userId must belong to the supplied email');
  result.accountScoped = true;

  await admin.getByLabel('搜索用户').fill(account.email);
  await admin.getByRole('button', {name: '搜索用户'}).click();
  await admin.getByRole('button', {name: `查看用户 ${target.username}`}).click();
  await admin.getByText('正在读取用户详情…').waitFor({state: 'hidden'});
  const newDisplayName = `服务器验收-${Date.now()}`;
  const auditReason = '服务器会员验收：资料关联验证';
  await admin.getByLabel('昵称').fill(newDisplayName);
  await admin.getByPlaceholder('说明为什么需要修改资料').fill(auditReason);
  await admin.getByRole('button', {name: '保存公开资料'}).click();
  await admin.getByText(auditReason, {exact: true}).waitFor();
  result.profileFormSave = true;

  const frontLoginResponse = await front.request.post(`${webOrigin}/api/auth/login`, {data: {email: account.email, password: account.password}});
  assert.equal(frontLoginResponse.status(), 200);
  const frontLoginBody = await frontLoginResponse.json();
  assert.equal(typeof frontLoginBody.token, 'string');
  const me = await front.request.get(`${webOrigin}/api/users/me`, {headers: {Authorization: `Bearer ${frontLoginBody.token}`}});
  assert.equal(me.status(), 200);
  assert.equal((await me.json()).displayName, newDisplayName);
  result.profileApiPropagation = true;

  await front.goto(`${webOrigin}/login`);
  await front.getByLabel(/邮箱/).fill(account.email);
  await front.getByRole('textbox', {name: '密码'}).fill(account.password);
  const browserLoginResponse = front.waitForResponse(response => response.url().includes('/api/auth/login') && response.request().method() === 'POST');
  await front.getByRole('button', {name: /登录/}).click();
  assert.equal((await browserLoginResponse).status(), 200);
  await front.goto(`${webOrigin}/profile`);
  await front.getByText(newDisplayName, {exact: true}).waitFor();
  result.profileDomPropagation = true;

  const adminCookieOnlyFrontend = await admin.request.get(`${webOrigin}/api/users/me`);
  assert.equal(adminCookieOnlyFrontend.status(), 401);
  result.adminCookieCannotUseFrontend = true;
  const frontendBearerAdmin = await front.request.get(`${webOrigin}/api/admin/auth/session`, {headers: {Authorization: `Bearer ${frontLoginBody.token}`}});
  assert.equal(frontendBearerAdmin.status(), 401);
  result.frontendBearerCannotUseAdmin = true;

  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
}
