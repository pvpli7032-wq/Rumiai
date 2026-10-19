import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir, open, rm} from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {chromium} from 'playwright';
import {createIsolatedDatabase} from './helpers/create-isolated-db.mjs';

const stamp = `${process.pid}-${Date.now()}`, file = `admin-management-browser-${stamp}.db`;
const out = path.resolve('artifacts/admin-management-browser', stamp), base = 'http://127.0.0.1:18798';
await mkdir(out, {recursive: true});
const env = {...process.env, NODE_ENV: 'production', DATABASE_URL: `file:./${file}`, JWT_SECRET: randomBytes(48).toString('hex'), OPENAI_API_KEY: '', EZFP_ENABLED: 'false', EZFP_REFUNDS_ENABLED: 'false', DISABLE_MOCK_AI: 'true', ALLOW_SIMULATED_PURCHASES: 'false', AI_BUDGET_CIRCUIT_BREAKER: 'false', MODERATOR_USER_IDS: '', PAYMENT_ADMIN_USER_IDS: '', NEXT_DIST_DIR: process.env.NEXT_DIST_DIR?.trim() || '.next-build', NEXT_PUBLIC_SITE_URL: base}; delete env.RUST_LOG;
Object.assign(process.env, env);
const dbPath = path.resolve('prisma', file)
await createIsolatedDatabase(dbPath);
const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {bootstrapOwner, saveOperator} = await import('../src/lib/admin/management-service.ts');
const password = randomBytes(24).toString('hex'), actors = [], checks = [], errors = [];
let app, browser;
try {
  for (const name of ['owner', 'staff', 'viewer', 'auditor']) actors.push(await db.user.create({data: {username: `${name}_${stamp}`, email: `${name}-${stamp}@example.invalid`, passwordHash: await bcrypt.hash(password, 10)}}));
  await bootstrapOwner(actors[0].email);
  for (const [index, code] of [[2, 'FINANCE_VIEWER'], [3, 'AUDITOR']]) {
    const role = await db.adminRole.findUnique({where: {code}});
    await saveOperator(actors[0].id, {userId: actors[index].id, enabled: true, version: 0, roleIds: [role.id], reason: '浏览器合成验收'});
  }
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '18798'], {env, stdio: 'ignore', windowsHide: true});
  let ready = false;
  for (let i = 0; i < 150; i++) {if (app.exitCode !== null) throw Error('owned app exited'); try {if ((await fetch(base + '/api/admin/access')).status === 401) {ready = true; break;}} catch {} await new Promise(resolve => setTimeout(resolve, 100));}
  assert(ready, 'owned app not ready'); browser = await chromium.launch();
  async function login(actor) {
    const context = await browser.newContext({viewport: {width: 1280, height: 900}});
    const response = await context.request.post(base + '/api/auth/login', {data: {email: actor.email, password}}); assert.equal(response.status(), 200);
    const {token} = await response.json(); await context.addInitScript(value => localStorage.setItem('xingban_token', value), token);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); return {context, page, token};
  }
  const owner = await login(actors[0]);
  await owner.page.goto(base + '/admin/operators'); await owner.page.getByRole('heading', {name: '管理员与角色', exact: true}).waitFor();
  await owner.page.getByLabel('角色名称', {exact: true}).fill('内容查看团队');
  await owner.page.getByLabel('查看审核与举报队列', {exact: true}).check();
  await owner.page.getByLabel('修改理由', {exact: true}).fill('仅授予审核队列查看权限');
  await owner.page.getByRole('button', {name: '保存角色', exact: true}).click();
  await owner.page.getByText('角色已保存，权限立即生效。', {exact: true}).waitFor();
  checks.push('通过页面新增自定义角色');
  await owner.page.getByLabel('查找已有账号', {exact: true}).fill(actors[1].email);
  await owner.page.getByRole('button', {name: '查找账号', exact: true}).click();
  await owner.page.getByLabel('内容查看团队', {exact: true}).check();
  await owner.page.getByLabel('操作理由', {exact: true}).fill('合成员工分配查看角色');
  await owner.page.getByRole('button', {name: '保存管理身份', exact: true}).click();
  await owner.page.getByText('管理身份已保存。', {exact: true}).waitFor();
  checks.push('通过页面查找账号并分配管理身份');
  const staff = await login(actors[1]); await staff.page.goto(base + '/admin/moderation'); await staff.page.getByRole('heading', {name: '审核中心', exact: true}).waitFor();
  await staff.page.waitForLoadState('networkidle'); assert.equal(await staff.page.getByRole('button', {name: '通过公开', exact: true}).count(), 0);
  assert.equal((await staff.context.request.get(base + '/api/admin/operators', {headers: {Authorization: `Bearer ${staff.token}`}})).status(), 403);
  const viewer = await login(actors[2]); await viewer.page.goto(base + '/admin/finance'); await viewer.page.getByRole('heading', {name: '充值套餐与赠送活动'}).waitFor();
  assert.equal(await viewer.page.getByRole('button', {name: '保存套餐', exact: true}).count(), 0); assert.equal(await viewer.page.getByLabel('退款原因', {exact: true}).count(), 0);
  const auditor = await login(actors[3]); await auditor.page.goto(base + '/admin/operators'); await auditor.page.getByRole('heading', {name: '角色与权限', exact: true}).waitFor();
  assert.equal(await auditor.page.getByRole('button', {name: '保存角色', exact: true}).count(), 0); assert.equal(await auditor.page.getByRole('button', {name: '查找账号', exact: true}).count(), 0);
  checks.push('审核查看员、财务查看员、审计员职责分离');
  await owner.page.getByRole('button', {name: `编辑 ${actors[1].username}`, exact: true}).click();
  await owner.page.getByLabel('启用管理身份', {exact: true}).uncheck();
  await owner.page.getByLabel('操作理由', {exact: true}).fill('撤销合成员工管理访问');
  const stopped = owner.page.waitForResponse(response => response.url().endsWith('/api/admin/operators') && response.request().method() === 'POST');
  await owner.page.getByRole('button', {name: '保存管理身份', exact: true}).click();
  assert.equal((await stopped).status(), 200);
  await owner.page.getByText('管理身份已保存。', {exact: true}).waitFor();
  // 停用管理身份会提升账号版本：旧令牌整体失效（401），重新登录后也不再有任何管理权限（403）。
  assert.equal((await staff.context.request.get(base + '/api/admin/moderation/characters', {headers: {Authorization: `Bearer ${staff.token}`}})).status(), 401);
  assert.equal((await staff.context.request.get(base + '/api/auth/me', {headers: {Authorization: `Bearer ${staff.token}`}})).status(), 401);
  const relogin = await staff.context.request.post(base + '/api/auth/login', {data: {email: actors[1].email, password}});
  assert.equal(relogin.status(), 200); const {token: freshToken} = await relogin.json();
  for (const contract of ['/api/admin/operators', '/api/admin/moderation/characters']) assert.equal((await staff.context.request.get(base + contract, {headers: {Authorization: `Bearer ${freshToken}`}})).status(), 403, `${contract} 仍向已停用身份返回数据`);
  checks.push('停用管理身份撤销已登录凭据，重新登录后管理接口全部拒绝');
  await owner.page.goto(base + '/admin/audit'); await owner.page.getByRole('heading', {name: '操作审计', exact: true}).waitFor(); await owner.page.getByText('撤销合成员工管理访问', {exact: true}).waitFor();
  checks.push('页面展示真实管理变更审计');
  await owner.page.getByLabel('对象ID',{exact:true}).fill(actors[1].id);
  await owner.page.getByLabel('动作代码',{exact:true}).fill('SAVE_OPERATOR');
  const filtered=owner.page.waitForResponse(response=>response.url().includes('/api/admin/audit?')&&response.url().includes('action=SAVE_OPERATOR'));
  await owner.page.getByRole('button',{name:'筛选审计',exact:true}).click();const filteredResponse=await filtered;assert.equal(filteredResponse.status(),200);
  const filteredReport=await filteredResponse.json();assert(filteredReport.total>=2);assert(filteredReport.items.every(item=>item.targetId===actors[1].id&&item.action==='SAVE_OPERATOR'));
  await owner.page.getByText('撤销合成员工管理访问',{exact:true}).waitFor();
  await owner.page.getByLabel('对象ID',{exact:true}).fill('no-such-audit-target');
  await owner.page.getByRole('button',{name:'筛选审计',exact:true}).click();await owner.page.getByText('暂无管理操作记录',{exact:true}).waitFor();
  await owner.page.getByRole('button',{name:'重置筛选',exact:true}).click();await owner.page.getByText('撤销合成员工管理访问',{exact:true}).waitFor();
  checks.push('审计对象与动作交集筛选、空结果及重置');
  for (const width of [390, 1280]) {
    await owner.page.setViewportSize({width, height: 900});
    for (const route of ['/admin/operators', '/admin/audit']) {
      await owner.page.goto(base + route); await owner.page.waitForLoadState('networkidle');
      const region = owner.page.getByRole('region', {name: '后台工作区'});
      const size = await region.evaluate(element => ({client: element.clientWidth, scroll: element.scrollWidth})); assert(size.scroll <= size.client + 1, `${route}: overflow at ${width}`);
      await owner.page.screenshot({path: path.join(out, `${route.split('/').at(-1)}-${width}.png`)});
    }
  }
  checks.push('权限与审计页面390/1280px布局'); assert.deepEqual(errors, []); console.log(JSON.stringify({checks, errors, artifacts: out}));
} finally {
  await browser?.close();
  if (app && app.exitCode === null) {if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'}); else app.kill('SIGTERM'); await new Promise(resolve => {if (app.exitCode !== null) resolve(); else app.once('exit', resolve);});}
  await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) await rm(dbPath + suffix, {force: true});
}
