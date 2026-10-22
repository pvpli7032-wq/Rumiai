import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir, open, rm} from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {chromium} from 'playwright';
import {createIsolatedDatabase} from './helpers/create-isolated-db.mjs';

/**
 * 后台响应式验收（V3 §8 表 25「后台布局」）：手机宽度不许整页横向溢出。
 *
 * 两条失败条件，缺一不可：
 * 1) document.scrollingElement.scrollWidth > 视口宽度 +1px —— 任务要求的整页口径。
 * 2) 后台工作区（[aria-label="后台工作区"]）scrollWidth > clientWidth +1px —— 内容区口径。
 *
 * 为什么必须加第 2 条：后台外壳根节点带 overflow-hidden（admin-shell.tsx:78），
 * 越界内容会被直接剪掉，整页 scrollWidth 因此永远是 360，第 1 条在结构上恒真。
 * 实测（往工作区塞一个 1200px 元素）：整页 scrollWidth 仍是 360，只有内容区 scrollWidth
 * 从 360 变 1200。只留第 1 条就是一条永远不会红的空验收，而「被剪掉」比「能横滚」更糟。
 * 内容区自身 overflow-x 计算为 auto，所以它真的溢出时用户确实要横向滚动 —— 这正是
 * 要拦的症状，不是误报。
 *
 * 页面内单个元素右边界超出视口只打印不作失败条件：表格本来就该在自己的
 * overflow-x-auto 容器里横向滚动，拿它当失败条件只会天天误报。
 */

// package.json 注册的是 `node scripts/verify-admin-responsive-browser.mjs`，本脚本却要 import
// src 下的 TS 模块（隔离库、Prisma 客户端），没有 tsx 加载器会直接 ERR_MODULE_NOT_FOUND。
// 这里补上加载器再重跑一次自己，保证注册的入口能一条命令跑通。
if (!process.env.XINGBAN_TSX_LOADER) {
  const relay = spawnSync(process.execPath, ['--import', 'tsx', ...process.argv.slice(1)], {stdio: 'inherit', env: {...process.env, XINGBAN_TSX_LOADER: '1'}, windowsHide: true});
  process.exit(relay.status ?? 1);
}

const stamp = `${process.pid}-${Date.now()}`;
const file = `admin-responsive-${stamp}.db`;
const port = 18851;
const base = `http://127.0.0.1:${port}`;
const out = path.resolve('artifacts/admin-responsive', stamp);
const distDir = process.env.NEXT_DIST_DIR?.trim() || '.next-build';
await mkdir(out, {recursive: true});

const env = {
  ...process.env,
  NODE_ENV: 'production',
  DATABASE_URL: `file:./${file}`,
  JWT_SECRET: randomBytes(48).toString('hex'),
  OPENAI_API_KEY: '',
  DISABLE_MOCK_AI: 'true',
  ALLOW_SIMULATED_PURCHASES: 'false',
  EZFP_ENABLED: 'false',
  EZFP_REFUNDS_ENABLED: 'false',
  AI_BUDGET_CIRCUIT_BREAKER: 'false',
  NEXT_DIST_DIR: distDir,
  NEXT_PUBLIC_SITE_URL: base,
};
delete env.RUST_LOG;
delete env.ISOLATED_BUILD_DIR;
Object.assign(process.env, env);

const dbPath = path.resolve('prisma', file);
await createIsolatedDatabase(dbPath);
const {db, pragmasReady} = await import('../src/lib/db.ts');
await pragmasReady;

// marker 是「真实内容已渲染」的锚点：只等外壳会量到一张空页，量不出真溢出。
const PAGES = [
  {path: '/admin', label: '工作台', marker: {role: 'heading', name: '管理中心'}},
  {path: '/admin/accounts', label: '用户管理', marker: {role: 'heading', name: '用户列表'}},
  {path: '/admin/settings', label: '设置中心', marker: {role: 'tablist', name: '设置分类'}},
  {path: '/admin/ai/costs', label: '价格与成本', marker: {role: 'heading', name: '价格与成本'}},
  {path: '/admin/finance', label: '财务支付', marker: {role: 'heading', name: '财务支付'}},
  // 通知统计由同事并行开发：路由还不存在时跳过，不让别人的进度把这条验收变红。
  {path: '/admin/notifications', label: '通知统计', marker: {role: 'heading', name: '通知统计'}, optional: true},
];
const WIDTHS = [360, 390];
const ALL = ['accounts.read', 'characters.read', 'moderation.read', 'community.read', 'site.content.read', 'disputes.read', 'mirror.read', 'growth.read', 'analytics.read', 'ai.models.read', 'ai.providers.read', 'ai.costs.read', 'finance.read', 'payments.merchants.read', 'settings.read', 'tasks.read', 'operations.read', 'admin.staff.read', 'admin.audit.read', 'compliance.read'];

/**
 * 量整页宽度，并挑出真正「没被任何滚动容器接住」的越界元素。
 *
 * 只把 overflow-x 为 auto/scroll 的祖先当成合法滚动容器；overflow-hidden 不算 ——
 * 那正是「把问题藏起来」的做法，越界元素应当照实报出来。
 */
function measure() {
  const scrolling = document.scrollingElement ?? document.documentElement;
  const viewport = document.documentElement.clientWidth;
  const insideScrollBox = node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const overflowX = getComputedStyle(parent).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
    return false;
  };
  const describe = node => {
    const parts = [];
    for (let current = node; current && current !== document.body && parts.length < 3; current = current.parentElement) {
      const classes = [...current.classList].slice(0, 2).join('.');
      parts.unshift(current.tagName.toLowerCase() + (classes ? '.' + classes : ''));
    }
    return parts.join(' > ');
  };
  const offenders = [];
  for (const node of document.querySelectorAll('body *')) {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.right <= viewport + 1 || insideScrollBox(node)) continue;
    offenders.push(`${describe(node)} (右边界 ${Math.round(rect.right)}px)`);
  }
  const region = document.querySelector('[aria-label="后台工作区"]');
  return {
    scrollWidth: scrolling.scrollWidth,
    clientWidth: viewport,
    regionScrollWidth: region?.scrollWidth ?? 0,
    regionClientWidth: region?.clientWidth ?? 0,
    offenders: offenders.slice(0, 5),
  };
}

const password = randomBytes(24).toString('hex');
async function makeAdmin(label, permissions) {
  const user = await db.user.create({data: {username: `${label}_${stamp}`, email: `${label}-${stamp}@example.invalid`, passwordHash: await bcrypt.hash(password, 8)}});
  const role = await db.adminRole.create({data: {code: `ROLE_${label.toUpperCase()}_${stamp.replace(/-/g, '')}`, name: label, permissions: {create: permissions.map(permission => ({permission}))}}});
  await db.adminOperator.create({data: {userId: user.id, enabled: true, version: 1}});
  await db.adminRoleAssignment.create({data: {userId: user.id, roleId: role.id}});
  return user;
}

const rows = [];
const failures = [];
const errors = [];
let app, browser;
try {
  await makeAdmin('responsive', ALL);
  // 列表页得有行才测得出真溢出：造 3 个用户（其中一人用长昵称）和 1 笔订单。
  const hash = await bcrypt.hash(password, 8);
  const seeded = await Promise.all([
    db.user.create({data: {username: `resp_a_${stamp}`, email: `resp-a-${stamp}@example.invalid`, displayName: '响应式测试用户甲', passwordHash: hash}}),
    db.user.create({data: {username: `resp_b_${stamp}`, email: `resp-b-${stamp}@example.invalid`, displayName: '这是一个用来撑开列表单元格的特别特别长的用户昵称测试样例', passwordHash: hash}}),
    db.user.create({data: {username: `resp_c_${stamp}`, email: `resp-c-${stamp}@example.invalid`, passwordHash: hash}}),
  ]);
  await db.paymentOrder.create({data: {orderNo: `ORDER-${stamp}`, idempotencyKey: `resp-${stamp}`, userId: seeded[0].id, packageCoins: 100, packageBonus: 0, coinAmount: 100, amountCnyCents: 600, status: 'PAID'}});

  const serverLog = path.join(out, 'server.log');
  const handle = await open(serverLog, 'w');
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {env, stdio: ['ignore', handle.fd, handle.fd], windowsHide: true});
  let ready = false;
  for (let index = 0; index < 480; index += 1) {
    if (app.exitCode !== null) throw Error('生产服务已退出，见 ' + serverLog);
    try {
      if ((await fetch(base + '/api/admin/session', {signal: AbortSignal.timeout(15000)})).status === 401) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, '生产服务没有就绪，见 ' + serverLog);

  browser = await chromium.launch();
  const context = await browser.newContext({viewport: {width: WIDTHS[0], height: 800}, locale: 'zh-CN'});
  const login = await context.request.post(base + '/api/auth/login', {data: {email: `responsive-${stamp}@example.invalid`, password}, timeout: 120000});
  assert.equal(login.status(), 200, await login.text());
  await context.addInitScript(value => localStorage.setItem('xingban_token', value), (await login.json()).token);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));

  for (const width of WIDTHS) {
    await page.setViewportSize({width, height: 800});
    for (const spec of PAGES) {
      const response = await page.goto(base + spec.path, {timeout: 120000});
      if (spec.optional && response?.status() === 404) {
        rows.push({path: spec.path, label: spec.label, width, skipped: '路由未建，跳过'});
        continue;
      }
      assert.notEqual(response?.status(), 404, `${spec.path} 返回 404`);
      await page.getByRole('region', {name: '后台工作区'}).waitFor({timeout: 120000});
      await page.getByRole(spec.marker.role, {name: spec.marker.name, exact: true}).first().waitFor({timeout: 120000});
      await page.waitForTimeout(300);
      const result = await page.evaluate(measure);
      const overflow = result.scrollWidth - result.clientWidth;
      const regionOverflow = result.regionScrollWidth - result.regionClientWidth;
      const row = {path: spec.path, label: spec.label, width, ...result, overflow, regionOverflow};
      rows.push(row);
      if (overflow > 1 || regionOverflow > 1) {
        failures.push(row);
        await page.screenshot({path: path.join(out, `${spec.path.replace(/\//g, '_')}-${width}.png`), fullPage: true});
      }
    }
  }

  const pad = (text, size) => text + ' '.repeat(Math.max(0, size - text.length));
  console.log('后台横向溢出检查（整页 scrollWidth 与内容区 scrollWidth 均不得超过各自 clientWidth +1px）');
  console.log(pad('页面', 22) + pad('路径', 24) + pad('宽度', 8) + pad('整页 scroll/client', 20) + pad('内容区 scroll/client', 22) + '结论');
  for (const row of rows) {
    const head = pad(row.label, 22) + pad(row.path, 24) + pad(row.width + 'px', 8);
    if (row.skipped) { console.log(head + pad('-', 20) + pad('-', 22) + '跳过（' + row.skipped + '）'); continue; }
    const docCell = `${row.scrollWidth}/${row.clientWidth}`;
    const regionCell = `${row.regionScrollWidth}/${row.regionClientWidth}`;
    const verdict = row.overflow > 1 ? `整页溢出 ${row.overflow}px` : row.regionOverflow > 1 ? `内容区溢出 ${row.regionOverflow}px` : 'OK';
    console.log(head + pad(docCell, 20) + pad(regionCell, 22) + verdict);
    for (const offender of row.offenders) console.log('    越界元素：' + offender);
  }
  const checked = rows.filter(row => !row.skipped).length;
  console.log(`\n共检查 ${checked} 组（${PAGES.length} 个页面 × ${WIDTHS.length} 档宽度），不合格 ${failures.length} 组。`);

  assert.deepEqual(errors, [], '页面不应有脚本错误');
  assert.equal(failures.length, 0, `横向溢出：${failures.map(row => `${row.path}@${row.width}px(整页+${row.overflow}/内容区+${row.regionOverflow})`).join('、')}`);
  console.log('PASS 后台在 ' + WIDTHS.join('px / ') + 'px 下均无整页横向溢出，内容区也无需横向滚动');
  console.log('artifacts: ' + out);
} finally {
  await browser?.close();
  if (app && app.exitCode === null) { app.kill(); await new Promise(resolve => app.once('exit', resolve)); }
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal']) await rm(path.resolve('prisma', file + suffix), {force: true});
}
