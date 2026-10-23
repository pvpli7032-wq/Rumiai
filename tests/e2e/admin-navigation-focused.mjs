import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {chromium} from 'playwright';

const origin = process.env.ADMIN_ORIGIN;
const token = process.env.ADMIN_SESSION_TOKEN;
assert.ok(origin && token, 'Provide ADMIN_ORIGIN and a temporary ADMIN_SESSION_TOKEN; no credentials are stored by this script.');
const originUrl = new URL(origin);
assert.equal(originUrl.pathname, '/', 'ADMIN_ORIGIN must be an origin without a path.');
assert.equal(originUrl.search, '', 'ADMIN_ORIGIN must not include a query string.');
assert.equal(originUrl.hash, '', 'ADMIN_ORIGIN must not include a fragment.');
const artifactDir = process.env.ADMIN_ARTIFACT_DIR || 'artifacts/admin-functional-round2';
mkdirSync(artifactDir, {recursive: true});

const report = {
  scope: 'navigation-state-focused',
  buildIds: {api: process.env.API_BUILD_ID || null, admin: process.env.ADMIN_BUILD_ID || null},
  expectedNavigationLeaves: 25,
  checks: [],
  dialogs: [],
  historyDebug: [],
  blockedWrites: [],
  unexpectedWrites: [],
  browserErrors: [],
  httpErrors: [],
};

const browser = await chromium.launch({headless: true});
const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
await context.addCookies([{
  name: 'xingban_admin_session', value: token, domain: originUrl.hostname, path: '/',
  httpOnly: true, secure: originUrl.protocol === 'https:', sameSite: 'Strict',
}]);
await context.route('**/*', async route => {
  const method = route.request().method();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    report.blockedWrites.push({method, path: new URL(route.request().url()).pathname});
    await route.abort('blockedbyclient');
    return;
  }
  await route.continue();
});

function pathOf(value) { try { const url = new URL(value); return url.pathname + url.search; } catch { return 'invalid'; } }
function settingsLocation(page) { const url = new URL(page.url()); return url.pathname + url.search; }
async function waitSettings(page, tab, section) {
  try {
    await page.waitForURL(value => value.pathname === '/admin/settings'
      && (tab === 'chat' ? value.searchParams.get('tab') === null : value.searchParams.get('tab') === tab)
      && value.searchParams.get('section') === section);
  } catch (error) {
    throw new Error(`Expected settings ${tab}/${section}, got ${settingsLocation(page)}`, {cause: error});
  }
  const label = {chat:'聊天与内容',billing:'计费额度',growth:'增长玩法',accounts:'账号运行',prompts:'提示词'}[tab];
  const selectedTab = page.getByRole('tab', {name: label, exact: true});
  const handle = await selectedTab.elementHandle();
  assert.ok(handle);
  await page.waitForFunction(element => element.getAttribute('aria-selected') === 'true', handle);
}
async function waitNavGroup(page, groupLabel, groupExpanded) {
  await page.waitForFunction(({groupLabel: groupName, expectedGroup}) => {
    const group = [...document.querySelectorAll('button.admin-nav-group')]
      .find(element => element.textContent?.includes(groupName));
    return group?.getAttribute('aria-expanded') === expectedGroup;
  }, {groupLabel, expectedGroup: groupExpanded}, {timeout: 5000});
}

async function newTrackedPage(name) {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  let dialogMode = 'dismiss';
  const pageDialogs = [];
  page.on('dialog', async dialog => {
    pageDialogs.push({type: dialog.type(), mode: dialogMode});
    report.dialogs.push({case: name, type: dialog.type(), mode: dialogMode});
    if (dialogMode === 'accept') await dialog.accept(); else await dialog.dismiss();
  });
  page.on('pageerror', error => report.browserErrors.push({case: name, path: pathOf(page.url()), message: error.message}));
  page.on('console', message => { if (message.type() === 'error') report.browserErrors.push({case: name, path: pathOf(page.url()), message: message.text().slice(0, 400)}); });
  page.on('request', request => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) report.unexpectedWrites.push({case: name, method: request.method(), path: pathOf(request.url())});
  });
  page.on('response', response => {
    if (response.status() >= 400) report.httpErrors.push({case: name, status: response.status(), method: response.request().method(), path: pathOf(response.url())});
  });
  return {page, pageDialogs, setDialogMode: value => { dialogMode = value; }};
}

try {
  {
    const {page, pageDialogs} = await newTrackedPage('settings-clean-history');
    await page.goto(origin + '/admin/settings?section=chat-input', {waitUntil: 'networkidle'});
    await waitSettings(page, 'chat', 'chat-input');
    await page.getByRole('tab', {name: '计费额度', exact: true}).click();
    await waitSettings(page, 'billing', 'billing-base');
    await page.getByRole('button', {name: /^结算与额度/}).click();
    await waitSettings(page, 'billing', 'billing-settlement');
    await page.goBack(); await waitSettings(page, 'billing', 'billing-base');
    await page.goBack(); await waitSettings(page, 'chat', 'chat-input');
    await page.goForward(); await waitSettings(page, 'billing', 'billing-base');
    await page.goForward(); await waitSettings(page, 'billing', 'billing-settlement');
    await page.reload({waitUntil: 'networkidle'}); await waitSettings(page, 'billing', 'billing-settlement');
    assert.equal(pageDialogs.length, 0);
    report.checks.push({name: 'settings clean group/section back-forward and refresh', passed: true, final: settingsLocation(page)});
    await page.close();
  }

  {
    const {page, pageDialogs} = await newTrackedPage('settings-dirty-same-group');
    await page.goto(origin + '/admin/settings?section=chat-input', {waitUntil: 'networkidle'});
    const field = page.locator('[data-setting-key="chat.maxMessageChars"] input');
    const original = await field.inputValue();
    const draft = String(Number(original) === 19873 ? 19872 : 19873);
    await field.fill(draft);
    await page.getByRole('button', {name: /^帖子/}).click();
    await waitSettings(page, 'chat', 'chat-posts');
    assert.equal(pageDialogs.length, 0);
    await page.goBack(); await waitSettings(page, 'chat', 'chat-input');
    assert.equal(await field.inputValue(), draft);
    assert.equal(pageDialogs.length, 0);
    await page.goForward(); await waitSettings(page, 'chat', 'chat-posts');
    assert.equal(pageDialogs.length, 0);
    await page.goBack(); await waitSettings(page, 'chat', 'chat-input');
    assert.equal(await field.inputValue(), draft);
    await page.screenshot({path: `${artifactDir}/nav-state-settings-same-group.png`, fullPage: true});
    report.checks.push({name: 'settings dirty same-group section history preserves draft without dialog', passed: true});
    await page.close();
  }

  {
    const {page, pageDialogs, setDialogMode} = await newTrackedPage('settings-dirty-cross-group');
    await page.goto(origin + '/admin/settings?section=chat-input', {waitUntil: 'networkidle'});
    report.historyDebug.push({at: 'chat', position: await page.evaluate(() => history.state?.__rumiaiSettingsPosition ?? null)});
    const nav = page.locator('nav[aria-label="后台导航"]:visible').first();
    await nav.getByRole('link', {name: '计费额度', exact: true}).click();
    await waitSettings(page, 'billing', 'billing-base');
    report.historyDebug.push({at: 'billing', position: await page.evaluate(() => history.state?.__rumiaiSettingsPosition ?? null)});
    const field = page.locator('[data-setting-key="billing.freeDailyMessages"] input');
    const original = await field.inputValue();
    const draft = String(Number(original) + 17);
    await field.fill(draft);
    setDialogMode('dismiss');
    const beforeCancel = pageDialogs.length;
    await page.goBack().catch(() => null);
    await page.waitForTimeout(500);
    report.historyDebug.push({at: 'after-cancel', position: await page.evaluate(() => history.state?.__rumiaiSettingsPosition ?? null), path: settingsLocation(page)});
    assert.equal(pageDialogs.length, beforeCancel + 1);
    await waitSettings(page, 'billing', 'billing-base');
    assert.equal(await field.inputValue(), draft);
    setDialogMode('accept');
    const beforeAccept = pageDialogs.length;
    await page.goBack().catch(() => null);
    await page.waitForTimeout(500);
    assert.equal(pageDialogs.length, beforeAccept + 1);
    await waitSettings(page, 'chat', 'chat-input');
    await page.goForward(); await waitSettings(page, 'billing', 'billing-base');
    report.checks.push({name: 'settings clean sidebar group link then dirty back cancel/retry accept once', passed: true});
    await page.close();
  }

  {
    const {page, pageDialogs, setDialogMode} = await newTrackedPage('settings-dirty-cross-page');
    await page.goto(origin + '/admin/settings?section=chat-input', {waitUntil: 'networkidle'});
    const field = page.locator('[data-setting-key="chat.maxMessageChars"] input');
    const original = await field.inputValue();
    const draft = String(Number(original) === 19731 ? 19730 : 19731);
    await field.fill(draft);
    await page.getByRole('button', {name: '搜索后台栏目'}).click();
    const search = page.getByRole('region', {name: '栏目快捷搜索'});
    await search.getByLabel('输入栏目名称').fill('用户管理');
    setDialogMode('dismiss');
    const beforeDismiss = pageDialogs.length;
    await search.getByRole('link', {name: /用户管理/}).click();
    assert.equal(pageDialogs.length, beforeDismiss + 1);
    assert.equal(new URL(page.url()).pathname, '/admin/settings');
    assert.equal(await field.inputValue(), draft);
    await page.getByRole('button', {name: '搜索后台栏目'}).click();
    const searchAfterDismiss = page.getByRole('region', {name: '栏目快捷搜索'});
    await searchAfterDismiss.getByLabel('输入栏目名称').fill('用户管理');
    setDialogMode('accept');
    await searchAfterDismiss.getByRole('link', {name: /用户管理/}).click();
    await page.waitForURL(value => value.pathname === '/admin/accounts');
    await page.getByRole('heading', {name: '用户管理', exact: true}).waitFor({state: 'visible'});
    assert.equal(pageDialogs.length, beforeDismiss + 2);
    report.checks.push({name: 'settings dirty cross-page navigation confirms and loads target route tree', passed: true});
    await page.close();
  }

  {
    const {page} = await newTrackedPage('sidebar-collapse-state');
    await page.goto(origin + '/admin/finance?tab=packages', {waitUntil: 'networkidle'});
    await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('admin.nav.open.')) localStorage.removeItem(key); });
    await page.reload({waitUntil: 'networkidle'});
    const nav = page.locator('nav[aria-label="后台导航"]:visible').first();
    const financeGroup = nav.locator('button.admin-nav-group').filter({hasText: '财务与支付'});
    assert.equal(await financeGroup.getAttribute('aria-expanded'), 'true');
    await financeGroup.click();
    await page.waitForTimeout(100);
    await page.reload({waitUntil: 'networkidle'});
    assert.equal(await financeGroup.getAttribute('aria-expanded'), 'false');
    await financeGroup.click();
    await page.getByRole('tab', {name: '退款', exact: true}).click();
    await page.waitForURL('**/admin/finance?tab=refunds');
    const saved = await page.evaluate(() => {
      const key = Object.keys(localStorage).find(item => item.startsWith('admin.nav.open.'));
      return key ? JSON.parse(localStorage.getItem(key) || '{}') : null;
    });
    assert.ok(saved);
    assert.equal(saved.groups.includes('finance'), true);
    await page.getByRole('button', {name: '搜索后台栏目'}).click();
    const search = page.getByRole('region', {name: '栏目快捷搜索'});
    await search.getByLabel('输入栏目名称').fill('分类标签');
    await search.getByRole('link', {name: /站点内容 · 分类标签/}).click();
    await page.waitForURL('**/admin/site-content?tab=tag');
    const contentGroup = nav.locator('button.admin-nav-group').filter({hasText: '内容与社区'});
    const contentParent = nav.getByRole('link', {name: '站点内容', exact: true});
    report.historyDebug.push({
      at: 'site-content-after-url-before-wait',
      groupExpanded: await contentGroup.getAttribute('aria-expanded'),
      parentActive: await contentParent.getAttribute('aria-current'),
    });
    await page.waitForFunction(() => {
      const group = [...document.querySelectorAll('button.admin-nav-group')]
        .find(element => element.textContent?.includes('内容与社区'));
      const parent = [...document.querySelectorAll('a')]
        .find(element => element.textContent?.trim() === '站点内容');
      return group?.getAttribute('aria-expanded') === 'true'
        && parent?.getAttribute('aria-current') === 'page';
    }, undefined, {timeout: 5000});
    report.historyDebug.push({
      at: 'site-content-after-url-after-wait',
      groupExpanded: await contentGroup.getAttribute('aria-expanded'),
      parentActive: await contentParent.getAttribute('aria-current'),
    });
    assert.equal(await contentGroup.getAttribute('aria-expanded'), 'true');
    assert.equal(await contentParent.getAttribute('aria-current'), 'page');
    assert.equal(await nav.getByRole('link', {name: '分类标签', exact: true}).count(), 0);
    await page.screenshot({path: `${artifactDir}/nav-state-sidebar.png`, fullPage: true});
    report.checks.push({name: 'sidebar manual collapse reload/same-branch persists; different branch opens', passed: true});
    await page.close();
  }

  {
    const {page} = await newTrackedPage('sidebar-last-active-branch');
    await page.goto(origin + '/admin/settings?section=chat-input', {waitUntil: 'networkidle'});
    const storageKey = await page.evaluate(() => Object.keys(localStorage).find(key => key.startsWith('admin.nav.open.')) || null);
    assert.ok(storageKey);
    await page.evaluate(key => localStorage.removeItem(key), storageKey);

    // No saved preference: first entry opens its global group, but secondary tabs stay in main.
    await page.goto(origin + '/admin/operations?tab=maintenance', {waitUntil: 'networkidle'});
    await waitNavGroup(page, '系统与安全', 'true');
    let saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), storageKey);
    assert.equal(saved.lastActiveBranch, 'system:/admin/operations');
    const nav = page.locator('nav[aria-label="后台导航"]:visible').first();
    assert.equal(await nav.getByRole('link', {name: '维护与证书', exact: true}).count(), 0);
    assert.equal(await page.getByRole('tab', {name: '维护与证书', exact: true}).count(), 1);
    await nav.locator('button.admin-nav-group').filter({hasText: '系统与安全'}).click();
    await page.reload({waitUntil: 'networkidle'});
    await waitNavGroup(page, '系统与安全', 'false');

    // Legacy state without lastActiveBranch migrates once, then a client branch change opens its parent.
    await page.evaluate(key => localStorage.setItem(key, JSON.stringify({groups: ['system'], entries: ['/admin/settings']})), storageKey);
    await page.goto(origin + '/admin/settings?section=chat-input', {waitUntil: 'networkidle'});
    await waitNavGroup(page, '系统与安全', 'true');
    saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), storageKey);
    assert.equal(saved.lastActiveBranch, 'system:/admin/settings');
    await nav.getByRole('link', {name: '系统运行', exact: true}).click();
    await page.getByRole('tab', {name: '维护与证书', exact: true}).click();
    await page.waitForURL('**/admin/operations?tab=maintenance');
    await waitNavGroup(page, '系统与安全', 'true');
    await page.screenshot({path: `${artifactDir}/nav-state-last-active.png`, fullPage: true});
    report.checks.push({name: 'sidebar group persistence, main-area secondary tabs, and client branch auto-open', passed: true});
    await page.close();
  }

  assert.equal(report.blockedWrites.length, 0, 'Focused state checks attempted a write request');
  assert.equal(report.unexpectedWrites.length, 0, 'Focused state checks emitted a non-read request');
  assert.deepEqual(report.browserErrors, []);
  assert.deepEqual(report.httpErrors, []);
} catch (error) {
  report.failure = String(error?.stack || error);
  process.exitCode = 1;
} finally {
  writeFileSync(`${artifactDir}/nav-state-summary.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({checks: report.checks.length, dialogs: report.dialogs.length, blockedWrites: report.blockedWrites.length, browserErrors: report.browserErrors.length, httpErrors: report.httpErrors.length, failed: Boolean(report.failure), expectedNavigationLeaves: report.expectedNavigationLeaves}));
}
