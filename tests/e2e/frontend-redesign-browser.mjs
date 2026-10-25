import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const baseURL = process.env.FRONTEND_REDESIGN_BASE_URL ?? 'http://127.0.0.1:3315';
const outputDir = process.env.FRONTEND_REDESIGN_OUTPUT_DIR ?? '/tmp/khui-m1-browser-qa';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/usr/lib64/chromium-browser/headless_shell';
const routes = ['/discover', '/chat', '/creator', '/square', '/profile'];
const mode = process.env.FRONTEND_REDESIGN_MODE ?? 'm1';
const axeCorePath = process.env.AXE_CORE_PATH ?? '/www/wwwroot/khui-ai/shared/browser-qa-tools/node_modules/axe-core/axe.min.js';

function fixtureRoutes(fixture) {
  const locale = fixture.locale ?? 'zh';
  const ids = fixture.ids ?? {};
  const required = ['characterId', 'shareChatId', 'circleId', 'disputeId', 'mirrorShareId', 'cmsPageSlug', 'creatorUsername', 'storySlug'];
  for (const key of required) assert.ok(ids[key], `fixture manifest must provide ids.${key}`);
  const routes = [
    `/${locale}`, `/${locale}/about`, `/${locale}/auth`, `/${locale}/character/${ids.characterId}`,
    `/${locale}/disputes`, `/${locale}/disputes/${ids.disputeId}`, `/${locale}/disputes/new`, `/${locale}/explore`,
    `/${locale}/mirror`, `/${locale}/mirror/${ids.mirrorShareId}`, `/${locale}/terms-and-policy`,
    '/activate-account', '/ai-usage', '/announcements', '/chat', '/chat-history', '/circles', `/circles/${ids.circleId}`,
    '/community-appeal', '/creator', '/discover', '/forgot-password', '/horoscope', '/leaderboard', '/login', '/membership',
    '/my-characters', '/my-reports', '/onboarding', `/pages/${ids.cmsPageSlug}`, '/profile', `/profile/${ids.creatorUsername}`,
    `/profile/${ids.creatorUsername}/connections`, '/register', '/reset-password', `/share/chat/${ids.shareChatId}`, '/shop', '/shop/ledger',
    '/sitemap.xml', '/square', `/stories/${ids.storySlug}`, '/verify-email',
  ];
  const skipped = ids.sitemapFile ? [] : [{route: '/sitemaps/[file]', reason: 'fixture has no verified sitemap shard; do not fabricate one'}];
  if (ids.sitemapFile) routes.splice(routes.indexOf('/square'), 0, `/sitemaps/${ids.sitemapFile}`);
  return {routes, skipped};
}

async function login(page, fixture) {
  const {email, password} = fixture.login ?? {};
  assert.ok(email && password, 'fixture manifest must provide login email and password');
  await page.goto(`${baseURL}/login`, {waitUntil: 'networkidle'});
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('form').getByRole('button', {name: /登录/}).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), {timeout: 10_000});
}

const AUTH_INTERFACE_ROUTES = new Set([
  '/activate-account', '/forgot-password', '/login', '/register', '/reset-password', '/verify-email',
]);

function publicRoutes(fixture) {
  const locale = fixture.locale ?? 'zh';
  const ids = fixture.ids;
  return new Set([
    `/${locale}`, `/${locale}/about`, `/${locale}/auth`, `/${locale}/character/${ids.characterId}`,
    `/${locale}/disputes`, `/${locale}/disputes/${ids.disputeId}`, `/${locale}/explore`, `/${locale}/mirror`,
    `/${locale}/mirror/${ids.mirrorShareId}`, `/${locale}/terms-and-policy`, '/announcements',
    `/pages/${ids.cmsPageSlug}`, `/share/chat/${ids.shareChatId}`, '/sitemap.xml',
    ...(ids.sitemapFile ? [`/sitemaps/${ids.sitemapFile}`] : []),
  ]);
}

function expectedMarker(fixture, route) {
  const ids = fixture.ids;
  const expected = fixture.expected ?? {};
  const mappings = new Map([
    [`/${fixture.locale ?? 'zh'}/character/${ids.characterId}`, 'characterTitle'],
    [`/${fixture.locale ?? 'zh'}/disputes/${ids.disputeId}`, 'disputeTitle'],
    [`/${fixture.locale ?? 'zh'}/mirror/${ids.mirrorShareId}`, 'mirrorTitle'],
    [`/circles/${ids.circleId}`, 'circleName'],
    [`/pages/${ids.cmsPageSlug}`, 'cmsTitle'],
    [`/profile/${ids.creatorUsername}`, 'creatorName'],
    [`/profile/${ids.creatorUsername}/connections`, 'connectionName'],
    [`/share/chat/${ids.shareChatId}`, 'shareChatTitle'],
    [`/stories/${ids.storySlug}`, 'storyTitle'],
    ['/chat', 'conversationTitle'],
    ['/discover', 'characterTitle'],
    [`/${fixture.locale ?? 'zh'}`, 'characterTitle'],
    ['/creator', 'creatorDraftTitle'],
    ['/my-characters', 'characterTitle'],
    ['/square', 'postTitle'],
    ['/circles', 'circleName'],
    ['/profile', 'fixtureUserName'],
  ]);
  const key = mappings.get(route);
  if (!key) return null;
  const marker = key === 'connectionName' ? ids.connectionName : expected[key];
  assert.ok(marker, `fixture manifest must provide ${key === 'connectionName' ? 'ids.connectionName' : `expected.${key}`} for ${route}`);
  return marker;
}

// Legacy entry URLs keep their compatibility behavior under the shared mobile UI.
async function assertEntryContract(page, fixture, route) {
  const locale = fixture.locale ?? 'zh';
  const oldCharacter = '/' + locale + '/character/' + fixture.ids.characterId;
  const aliases = new Map([
    ['/' + locale, {status: 308, path: '/discover', query: {}}],
    ['/' + locale + '/explore', {status: 308, path: '/discover', query: {view: 'characters'}}],
    [oldCharacter, {status: 308, path: '/discover', query: {character: fixture.ids.characterId}}],
    ['/' + locale + '/auth', {status: 307, path: '/login', query: {next: '/discover'}}],
  ]);
  const expected = aliases.get(route);
  if (!expected) return false;
  const original = await page.request.get(baseURL + route, {maxRedirects: 0});
  assert.equal(original.status(), expected.status, route + ' must keep its explicit compatibility redirect');
  const location = new URL(original.headers().location, baseURL);
  const current = new URL(page.url());
  for (const actual of [location, current]) {
    assert.equal(actual.origin, new URL(baseURL).origin, route + ' must stay on the current origin');
    assert.equal(actual.pathname, expected.path, route + ' must reach the shared entry');
    assert.deepEqual(Object.fromEntries(actual.searchParams), expected.query, route + ' must preserve its selected destination');
  }
  if (route === '/' + locale + '/explore') {
    const filtered = await page.request.get(baseURL + route + '?type=e2e-type-0,e2e-type-1&type=e2e-type-0&tag=e2e-type-1&tag=e2e-type-2&search=E2E', {maxRedirects: 0});
    assert.equal(filtered.status(), 308);
    const destination = new URL(filtered.headers().location, baseURL);
    assert.equal(destination.origin, new URL(baseURL).origin);
    assert.equal(destination.pathname, '/discover');
    assert.equal(destination.searchParams.get('q'), 'E2E');
    assert.deepEqual(destination.searchParams.getAll('type'), ['e2e-type-0,e2e-type-1,e2e-type-2'], 'repeated/comma-separated types and legacy tags must compose without duplicates');
    assert.equal(destination.searchParams.has('tag'), false);
    assert.equal(destination.searchParams.has('search'), false);
  }
  if (route === oldCharacter) {
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', {name: fixture.expected.characterTitle, exact: true}).waitFor({state: 'visible'});
    assert.equal(await dialog.count(), 1, 'legacy character link must open exactly one real detail dialog');
    await dialog.getByRole('button', {name: /开始聊天|进入场景/}).waitFor({state: 'visible'});
  } else if (expected.path === '/login') {
    await page.locator('form input[type=email]').waitFor({state: 'visible'});
    await page.locator('form input[type=password]').waitFor({state: 'visible'});
  } else {
    await page.getByRole('searchbox', {name: '搜索角色', exact: true}).waitFor({state: 'visible'});
    await page.getByRole('navigation', {name: '主导航'}).waitFor({state: 'visible'});
  }
  return true;
}

async function assertExpectedContent(page, fixture, route) {
  const marker = expectedMarker(fixture, route);
  if (!marker) return;
  const body = await page.locator('body').innerText();
  assert.ok(body.includes(marker), `${route} must render fixture marker: ${marker}`);
}

async function basicA11y(page) {
  const title = await page.title();
  const lang = await page.locator('html').getAttribute('lang');
  const unlabeledControls = await page.locator('button, input, select, textarea, a[href]').evaluateAll((nodes) => nodes
    .filter((node) => {
      const element = /** @type {HTMLElement} */ (node);
      const text = [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent, element.getAttribute('placeholder')]
        .filter(Boolean).join('').trim();
      return !text;
    }).length);
  const invalidDialogs = await page.locator('[role="dialog"][aria-modal="true"]').evaluateAll((nodes) => nodes
    .filter((node) => !node.getAttribute('aria-label') && !node.getAttribute('aria-labelledby')).length);
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return false;
    const style = getComputedStyle(element);
    return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
  });
  return {
    documentTitle: Boolean(title.trim()),
    documentLanguage: Boolean(lang?.trim()),
    unlabeledControls,
    invalidDialogs,
    visibleKeyboardFocus: focus,
  };
}

async function axeAudit(page, route) {
  if (route.includes('sitemap')) return {status: 'not-applicable', reason: 'XML handler; no rendered HTML accessibility tree'};
  await page.addScriptTag({path: axeCorePath});
  return page.evaluate(async () => {
    const report = await window.axe.run(document, {
      runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa']},
    });
    return {
      status: 'checked',
      violations: report.violations.map(({id, impact, help, nodes}) => ({
        id, impact, help,
        nodes: nodes.map((node) => ({target: node.target, failureSummary: node.failureSummary})),
      })),
      incomplete: report.incomplete.map(({id, help}) => ({id, help})),
    };
  });
}

async function contextFor(browser, fixture, config, authenticated) {
  const context = await browser.newContext({viewport: config.viewport, isMobile: config.mobile, deviceScaleFactor: 1});
  await context.addInitScript((theme) => localStorage.setItem('theme', theme), config.theme);
  const page = await context.newPage();
  if (authenticated) await login(page, fixture);
  return {context, page};
}

async function navigateForMatrix(page, route) {
  const requestCounts = new Map();
  const onRequest = (request) => {
    if (route === '/membership' && request.url().includes('/api/')) {
      const url = new URL(request.url());
      const key = `${request.method()} ${url.pathname}`;
      requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
    }
  };
  page.on('request', onRequest);
  try {
    const response = await page.goto(`${baseURL}${route}`, {
      waitUntil: route.includes('sitemap') || route === '/membership' ? 'domcontentloaded' : 'networkidle',
    });
    if (route === '/membership') {
      await page.getByText('会员中心', {exact: true}).waitFor({state: 'visible', timeout: 10_000});
      await page.waitForTimeout(1500);
      const repeated = [...requestCounts.entries()].filter(([, count]) => count > 3);
      assert.equal(repeated.length, 0, `/membership repeats API requests after initial load: ${JSON.stringify(repeated)}`);
    }
    return {response, requestCounts: Object.fromEntries(requestCounts)};
  } finally {
    page.off('request', onRequest);
  }
}

async function assertXmlHandler(response, route, fixture) {
  const contentType = response.headers()['content-type'] ?? '';
  assert.match(contentType, /xml/i, `${route} must return an XML content type`);
  const xml = await response.text();
  assert.match(xml, /<\?xml|<(?:urlset|sitemapindex)\b/i, `${route} must return XML sitemap content`);
  if (route === '/sitemap.xml') {
    assert.ok(fixture.ids.sitemapFile, 'fixture manifest must provide a real sitemapFile');
    assert.ok(xml.includes(`/sitemaps/${fixture.ids.sitemapFile}`), '/sitemap.xml must reference the fixture shard');
  } else {
    assert.match(xml, /<urlset\b/i, `${route} shard must be a URL set`);
  }
}

async function runMatrix(browser) {
  const manifestPath = process.env.FRONTEND_REDESIGN_FIXTURE_MANIFEST;
  assert.ok(manifestPath, 'FRONTEND_REDESIGN_FIXTURE_MANIFEST is required for matrix mode');
  const fixture = JSON.parse(await readFile(manifestPath, 'utf8'));
  const {routes: matrixRoutes, skipped} = fixtureRoutes(fixture);
  const publicRouteSet = publicRoutes(fixture);
  const mobileWidths = (process.env.FRONTEND_REDESIGN_MOBILE_WIDTHS ?? '390').split(',').map(Number).filter(Number.isFinite);
  assert.ok(mobileWidths.length > 0, 'FRONTEND_REDESIGN_MOBILE_WIDTHS must contain at least one mobile width');
  const configs = mobileWidths.flatMap((width) => ['light', 'dark'].map((theme) => ({
    name: width === 390 ? `mobile-${theme}` : `mobile-${width}-${theme}`,
    viewport: {width, height: 844}, mobile: true, theme,
  })));
  const results = [];
  let failedRoute = null;
  const failures = [];
  let axeFailures = null;
  const reportPath = path.join(outputDir, 'route-matrix.json');
  const checkpoint = () => writeFile(reportPath, JSON.stringify({baseURL, results, skipped, failedRoute, failures, axeFailures}, null, 2));
  try {
  for (const config of configs) {
    const auth = await contextFor(browser, fixture, config, true);
    const anonymous = await contextFor(browser, fixture, config, false);
    for (const route of matrixRoutes) {
      try {
        const isAuthInterface = AUTH_INTERFACE_ROUTES.has(route) || route.endsWith('/auth');
        const isPublic = publicRouteSet.has(route);
        const page = isPublic || isAuthInterface ? anonymous.page : auth.page;
        const navigation = await navigateForMatrix(page, route);
        const status = navigation.response?.status() ?? 0;
        assert.equal(status, 200, `${config.name} ${route} must return 200`);
        if (route.includes('sitemap')) {
          await assertXmlHandler(navigation.response, route, fixture);
          results.push({
            config: config.name, route, status, finalUrl: page.url(), requestCounts: navigation.requestCounts,
            routeMode: 'xml-handler', accessibility: {status: 'not-applicable', reason: 'XML handler; no HTML accessibility tree'},
          });
          await checkpoint();
          continue;
        }
        const compatibilityEntry = await assertEntryContract(page, fixture, route);
        if (isPublic && !isAuthInterface && !compatibilityEntry) assert.equal(new URL(page.url()).pathname, route, `${config.name} public ${route} must remain on its public business page`);
        if (!isPublic && !isAuthInterface) assert.ok(!page.url().includes('/login'), `${config.name} protected ${route} must not be replaced by anonymous login`);
        await assertExpectedContent(page, fixture, route);
        const overflow = config.mobile && !route.includes('sitemap')
          ? await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
          : false;
        assert.equal(overflow, false, `${config.name} ${route} must not overflow horizontally`);
        results.push({
          config: config.name, route, status, finalUrl: page.url(), requestCounts: navigation.requestCounts,
          routeMode: compatibilityEntry ? 'anonymous-compatibility-entry' : isAuthInterface ? 'anonymous-auth-interface' : isPublic ? 'anonymous-public' : 'fixture-session',
          accessibility: {...await basicA11y(page), axe: await axeAudit(page, route)},
        });
        if (['/discover', '/chat', '/creator', '/square', '/profile'].includes(route)) {
          await page.screenshot({path: path.join(outputDir, `${route.slice(1)}-${config.name}-fixture.png`), fullPage: true});
        }
        await checkpoint();
      } catch (error) {
        const failure = {config: config.name, route, error: error instanceof Error ? error.message : String(error)};
        failedRoute ??= failure;
        failures.push(failure);
        await checkpoint();
        if (/ECONNREFUSED|ERR_CONNECTION|Target page, context or browser has been closed|browser has been closed/i.test(failure.error)) throw error;
      }
    }
    await auth.context.close();
    await anonymous.context.close();
  }
  axeFailures = results.filter((result) => result.accessibility?.axe?.status === 'checked' && result.accessibility.axe.violations.length > 0);
  await checkpoint();
  assert.equal(failures.length, 0, `${failures.length} route/config checks failed; see route-matrix.json`);
  assert.equal(axeFailures.length, 0, `${axeFailures.length} route/config accessibility audits contain axe violations; see route-matrix.json`);
  console.log(JSON.stringify({status: 'passed', mode: 'matrix', baseURL, resultCount: results.length, skipped, accessibilityScope: 'axe WCAG 2 A/AA/2.1 AA plus basic semantic, dialog and keyboard-focus checks; manual review remains necessary for visual reference fidelity and incomplete axe findings'}));
  } finally {
    await checkpoint();
  }
}

await mkdir(outputDir, {recursive: true});

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  if (mode === 'matrix') {
    await runMatrix(browser);
    process.exitCode = 0;
  } else {
  const desktop = await browser.newContext({viewport: {width: 1440, height: 960}});
  const page = await desktop.newPage();

  // A clean context must use the light default, not a stale saved preference.
  await page.goto(`${baseURL}/discover`, {waitUntil: 'networkidle'});
  await page.waitForTimeout(300);
  assert.equal(await page.locator('html').evaluate((el) => el.classList.contains('dark')), false, 'light must be the default theme');

  const sidebar = page.locator('aside');
  await assert.doesNotReject(() => sidebar.waitFor({state: 'visible'}));
  const sidebarWidth = await sidebar.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  assert.equal(sidebarWidth, 256, `desktop sidebar must be 256px, received ${sidebarWidth}px`);

  const pwaNotice = page.locator('.pwa-notice');
  if (await pwaNotice.count()) {
    const box = await pwaNotice.first().boundingBox();
    assert.ok(!box || box.y >= 72, 'PWA notice must not cover the top header');
  }

  await page.getByRole('button', {name: '深色'}).click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('html').evaluate((el) => el.classList.contains('dark')), true, 'dark choice must apply');
  await page.reload({waitUntil: 'networkidle'});
  assert.equal(await page.locator('html').evaluate((el) => el.classList.contains('dark')), true, 'saved theme must survive reload');
  await page.screenshot({path: path.join(outputDir, 'discover-desktop-dark.png'), fullPage: true});

  await page.getByRole('button', {name: '浅色'}).click();
  await page.waitForTimeout(100);
  await page.screenshot({path: path.join(outputDir, 'discover-desktop-light.png'), fullPage: true});

  await page.emulateMedia({colorScheme: 'dark'});
  await page.getByRole('button', {name: '跟随系统'}).click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('html').evaluate((el) => el.classList.contains('dark')), true, 'system theme must follow a dark OS preference');
  await page.emulateMedia({colorScheme: 'light'});
  await page.waitForTimeout(100);
  assert.equal(await page.locator('html').evaluate((el) => el.classList.contains('dark')), false, 'system theme must follow a light OS preference');

  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const element = document.activeElement;
    const style = element ? getComputedStyle(element) : null;
    return {tag: element?.tagName, outlineStyle: style?.outlineStyle, outlineWidth: style?.outlineWidth};
  });
  assert.notEqual(focus.outlineStyle, 'none', 'keyboard focus needs a visible outline');
  await desktop.close();

  const mobile = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, deviceScaleFactor: 1});
  const mobilePage = await mobile.newPage();
  for (const route of routes) {
    const response = await mobilePage.goto(`${baseURL}${route}`, {waitUntil: 'networkidle'});
    assert.equal(response?.status(), 200, `${route} must return 200 in the candidate preview`);
    const nav = mobilePage.getByRole('navigation', {name: '主导航'});
    await assert.doesNotReject(() => nav.waitFor({state: 'visible'}));
    assert.equal(await nav.getByRole('link').count(), 5, `${route} mobile nav must expose all five primary entries`);
    const overflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, `${route} must not overflow horizontally at 390px`);
    await mobilePage.screenshot({path: path.join(outputDir, `${route.slice(1)}-mobile.png`), fullPage: true});
  }
  await mobile.close();
  console.log(JSON.stringify({status: 'passed', baseURL, outputDir, routes}));
  }
} finally {
  await browser.close();
}
