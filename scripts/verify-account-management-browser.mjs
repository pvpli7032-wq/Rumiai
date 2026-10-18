import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir, open, rm} from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {chromium} from 'playwright';

const stamp = `${process.pid}-${Date.now()}`, file = `account-browser-${stamp}.db`;
const out = path.resolve('artifacts/account-management-browser', stamp), base = 'http://127.0.0.1:18797';
await mkdir(out, {recursive: true});
const env = {...process.env, NODE_ENV: 'production', DATABASE_URL: `file:./${file}`, UPLOADS_DIRECTORY: path.join(out, 'uploads'), JWT_SECRET: randomBytes(48).toString('hex'), OPENAI_API_KEY: '', EZFP_ENABLED: 'false', EZFP_REFUNDS_ENABLED: 'false', DISABLE_MOCK_AI: 'true', ALLOW_SIMULATED_PURCHASES: 'false', AI_BUDGET_CIRCUIT_BREAKER: 'false', MODERATOR_USER_IDS: '', PAYMENT_ADMIN_USER_IDS: '', NEXT_DIST_DIR: '.next-build', NEXT_PUBLIC_SITE_URL: base}; delete env.RUST_LOG;
Object.assign(process.env, env);
const dbPath = path.resolve('prisma', file), empty = await open(dbPath, 'wx'); await empty.close();
const migrate = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true}); assert.equal(migrate.status, 0, 'isolated migration failed');
const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {bootstrapOwner, saveOperator, saveRole} = await import('../src/lib/admin/management-service.ts');
const password = randomBytes(24).toString('hex'), actors = [], checks = [], errors = [];
let app, browser, passed = false;
try {
  for (const name of ['owner', 'support', 'viewer', 'customer']) actors.push(await db.user.create({data: {username: `${name}_${stamp}`, email: `${name}-${stamp}@example.invalid`, passwordHash: await bcrypt.hash(password, 10)}}));
  await bootstrapOwner(actors[0].email);
  const support = await db.adminRole.findUnique({where: {code: 'SUPPORT_AGENT'}}), viewer = await saveRole(actors[0].id, {name: '只读用户', permissions: ['accounts.read'], reason: '合成浏览器验收'});
  for (const [index, roleId] of [[1, support.id], [2, viewer.id]]) await saveOperator(actors[0].id, {userId: actors[index].id, roleIds: [roleId], enabled: true, version: 0, reason: '合成浏览器验收'});
  await db.character.create({data: {creatorId: actors[3].id, name: '合成用户关联角色', personality: 'PRIVATE_PERSONA_MUST_NOT_BE_VISIBLE', background: '合成背景', reviewStatus: 'DRAFT'}});
  await db.coinTransaction.create({data: {userId: actors[3].id, type: 'CHECKIN', amount: 2}});
  const log = await open(path.join(out, 'server.log'), 'a');
  try {app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '18797'], {env, stdio: ['ignore', log.fd, log.fd], windowsHide: true});} finally {await log.close();}
  let ready = false;
  for (let i = 0; i < 150; i++) {if (app.exitCode !== null) throw Error('owned server exited'); try {if ((await fetch(base + '/api/admin/accounts')).status === 401) {ready = true; break;}} catch {} await new Promise(resolve => setTimeout(resolve, 100));}
  assert(ready, 'owned server not ready'); browser = await chromium.launch();
  async function login(actor) {
    const context = await browser.newContext({viewport: {width: 1280, height: 900}});
    const response = await context.request.post(base + '/api/auth/login', {data: {email: actor.email, password}}); assert.equal(response.status(), 200);
    const {token} = await response.json(); await context.addInitScript(value => localStorage.setItem('xingban_token', value), token);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); return {context, page, token};
  }
  const owner = await login(actors[0]), customer = await login(actors[3]);
  await owner.page.goto(base + '/admin'); await owner.page.getByRole('link', {name: /用户管理.*用户查询/}).click(); await owner.page.waitForURL('**/admin/accounts');
  async function selectUser(page, actor) {
    await page.getByLabel('搜索用户', {exact: true}).fill(actor.email); await page.getByRole('button', {name: '搜索用户', exact: true}).click();
    await page.getByRole('button', {name: `查看用户 ${actor.username}`, exact: true}).click(); await page.getByRole('region', {name: '用户详情'}).waitFor();
  }
  await selectUser(owner.page, actors[3]); await owner.page.getByRole('heading', {name: '近期金币流水', exact: true}).waitFor();
  assert(!(await owner.page.content()).includes('PRIVATE_PERSONA_MUST_NOT_BE_VISIBLE')); checks.push('工作台入口、用户搜索、关联资料与私有内容边界');
  owner.page.on('dialog', dialog => void dialog.accept());
  async function execute(page, action, reason) {
    await page.getByLabel('操作类型', {exact: true}).selectOption(action); await page.getByLabel('操作理由', {exact: true}).fill(reason);
    const response = page.waitForResponse(value => value.url().includes('/api/admin/accounts/') && value.request().method() === 'PATCH');
    await page.getByRole('button', {name: '执行账号操作', exact: true}).click(); return response;
  }
  assert.equal((await execute(owner.page, 'SUSPEND', '浏览器临时停用')).status(), 200); await owner.page.getByText('停用网站账号已完成。', {exact: true}).waitFor();
  assert.equal((await customer.context.request.get(base + '/api/auth/me', {headers: {Authorization: `Bearer ${customer.token}`}})).status(), 401);
  assert.equal((await customer.context.request.post(base + '/api/auth/login', {data: {email: actors[3].email, password}})).status(), 403);
  await owner.page.getByLabel('操作类型', {exact: true}).waitFor();
  assert.equal((await execute(owner.page, 'RESTORE', '浏览器恢复账号')).status(), 200); await owner.page.getByText('恢复网站账号已完成。', {exact: true}).waitFor();
  assert.equal((await customer.context.request.post(base + '/api/auth/login', {data: {email: actors[3].email, password}})).status(), 200); checks.push('页面停用/恢复、旧会话撤销及登录状态闭环');
  const supportActor = await login(actors[1]); await supportActor.page.goto(base + '/admin/accounts'); await selectUser(supportActor.page, actors[3]);
  assert.equal(await supportActor.page.getByRole('option', {name: '停用网站账号', exact: true}).count(), 0); assert.equal(await supportActor.page.getByRole('heading', {name: '近期金币流水', exact: true}).count(), 0);
  assert.equal((await execute(supportActor.page, 'BAN_COMMUNITY', '客服社区禁言验收')).status(), 200); await supportActor.page.getByText('禁止社区发言已完成。', {exact: true}).waitFor();
  await supportActor.page.getByLabel('操作类型', {exact: true}).waitFor();
  assert.equal((await execute(supportActor.page, 'UNBAN_COMMUNITY', '客服解除禁言')).status(), 200); await supportActor.page.getByText('恢复社区发言已完成。', {exact: true}).waitFor();
  checks.push('客服权限限定及社区禁言/恢复');
  const readonly = await login(actors[2]); await readonly.page.goto(base + '/admin/accounts'); await selectUser(readonly.page, actors[3]);
  assert.equal(await readonly.page.getByLabel('操作类型', {exact: true}).count(), 0); checks.push('只读运营身份没有写入入口');
  await owner.page.getByRole('button', {name: '关闭详情', exact: true}).click(); await selectUser(owner.page, actors[0]);
  assert.equal((await execute(owner.page, 'SUSPEND', '拒绝误停最后所有者')).status(), 409);
  await owner.page.getByRole('alert').filter({hasText: '不能停用最后一个有效所有者'}).waitFor(); await owner.page.waitForLoadState('networkidle');
  assert(await owner.page.getByRole('alert').filter({hasText: '不能停用最后一个有效所有者'}).isVisible()); checks.push('状态冲突错误刷新后继续显示');
  for (const width of [360, 390, 768, 1280]) {
    await owner.page.setViewportSize({width, height: 900}); await owner.page.goto(base + '/admin/accounts'); await owner.page.waitForLoadState('networkidle');
    const region = owner.page.getByRole('region', {name: '后台工作区'}); const size = await region.evaluate(element => ({client: element.clientWidth, scroll: element.scrollWidth})); assert(size.scroll <= size.client + 1, `overflow ${width}`);
    await owner.page.screenshot({path: path.join(out, `accounts-${width}.png`)});
  }
  checks.push('360/390/768/1280px布局'); assert.deepEqual(errors, []); passed = true; console.log(JSON.stringify({checks, errors, artifacts: out}));
} finally {
  await browser?.close();
  if (app && app.exitCode === null) {if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'}); else app.kill('SIGTERM'); await new Promise(resolve => {if (app.exitCode !== null) resolve(); else app.once('exit', resolve);});}
  await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) await rm(dbPath + suffix, {force: true});
  await rm(path.join(out, 'server.log'), {force: true});
}
