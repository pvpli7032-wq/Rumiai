import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir, open, rm} from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {chromium} from 'playwright';

const stamp = `${process.pid}-${Date.now()}`, file = `character-browser-${stamp}.db`, base = 'http://127.0.0.1:18796';
const out = path.resolve('artifacts/character-management-browser', stamp); await mkdir(out, {recursive: true});
const env = {...process.env, NODE_ENV: 'production', DATABASE_URL: `file:./${file}`, UPLOADS_DIRECTORY: path.join(out, 'uploads'), JWT_SECRET: randomBytes(48).toString('hex'), OPENAI_API_KEY: '', EZFP_ENABLED: 'false', EZFP_REFUNDS_ENABLED: 'false', DISABLE_MOCK_AI: 'true', ALLOW_SIMULATED_PURCHASES: 'false', AI_BUDGET_CIRCUIT_BREAKER: 'false', MODERATOR_USER_IDS: '', PAYMENT_ADMIN_USER_IDS: '', NEXT_DIST_DIR: '.next-build', NEXT_PUBLIC_SITE_URL: base}; delete env.RUST_LOG;
Object.assign(process.env, env); const dbPath = path.resolve('prisma', file), empty = await open(dbPath, 'wx'); await empty.close();
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true}); assert.equal(migration.status, 0, 'isolated migration failed');
const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {bootstrapOwner, saveOperator, saveRole} = await import('../src/lib/admin/management-service.ts');
const password = randomBytes(24).toString('hex'), actors = [], checks = [], errors = [];
let app, browser, passed = false;
try {
  for (const name of ['owner', 'editor', 'publisher', 'reader', 'ordinary']) actors.push(await db.user.create({data: {username: `${name}_${stamp}`, email: `${name}-${stamp}@example.invalid`, passwordHash: await bcrypt.hash(password, 10)}}));
  await bootstrapOwner(actors[0].email);
  for (const [index, permissions] of [[1, ['characters.read', 'characters.write']], [2, ['characters.read', 'characters.publish']], [3, ['characters.read']]]) {
    const role = await saveRole(actors[0].id, {name: actors[index].username, permissions, reason: '合成浏览器权限'});
    await saveOperator(actors[0].id, {userId: actors[index].id, roleIds: [role.id], enabled: true, version: 0, reason: '合成浏览器权限'});
  }
  const log = await open(path.join(out, 'server.log'), 'a');
  try {app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '18796'], {env, stdio: ['ignore', log.fd, log.fd], windowsHide: true});} finally {await log.close();}
  let ready = false;
  for (let i = 0; i < 150; i++) {if (app.exitCode !== null) throw Error('owned server exited'); try {if ((await fetch(base + '/api/characters/management')).status === 401) {ready = true; break;}} catch {} await new Promise(resolve => setTimeout(resolve, 100));}
  assert(ready, 'owned server not ready'); browser = await chromium.launch();
  async function login(actor) {
    const context = await browser.newContext({viewport: {width: 1280, height: 900}}); const response = await context.request.post(base + '/api/auth/login', {data: {email: actor.email, password}}); assert.equal(response.status(), 200);
    const {token} = await response.json(); await context.addInitScript(value => localStorage.setItem('khuiai_token', value), token);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => void dialog.accept()); return {context, page, token};
  }
  const editor = await login(actors[1]); await editor.page.goto(base + '/admin'); await editor.page.getByRole('link', {name: /角色管理.*全部状态/}).click(); await editor.page.waitForURL('**/admin/characters');
  await editor.page.getByRole('button', {name: '新增角色', exact: true}).click();
  for (const [label, value] of [['角色名称', '运营测试角色'], ['人设', 'PRIVATE_PERSONA_SYNTHETIC'], ['背景', '合成测试背景'], ['版权声明', '合成原创，仅验收'], ['标签', '原创,猫'], ['头像地址', '/brand/icon.svg'], ['初始关系', '朋友']]) await editor.page.getByLabel(label, {exact: true}).fill(value);
  await editor.page.getByLabel('初始好感值', {exact: true}).fill('1100');
  await editor.page.getByRole('button', {name: '新增画廊项', exact: true}).click(); await editor.page.getByLabel('画廊地址 1', {exact: true}).fill('/brand/icon.svg');
  await editor.page.getByRole('button', {name: '新增表情项', exact: true}).click(); await editor.page.getByLabel('表情名称 1', {exact: true}).fill('happy'); await editor.page.getByLabel('表情图片 1', {exact: true}).fill('/brand/icon.svg');
  await editor.page.getByRole('button', {name: '新增配角', exact: true}).click(); await editor.page.getByLabel('配角名称 1', {exact: true}).fill('合成配角'); await editor.page.getByLabel('配角说明 1', {exact: true}).fill('合成说明');
  await editor.page.getByLabel('操作理由', {exact: true}).fill('浏览器创建结构化角色');
  const created = editor.page.waitForResponse(response => response.url().endsWith('/api/characters/management') && response.request().method() === 'POST');
  await editor.page.getByRole('button', {name: '保存角色内容', exact: true}).click(); const createdResponse = await created; assert.equal(createdResponse.status(), 201); const role = await createdResponse.json();
  assert.equal(role.creatorId, null);
  await editor.page.getByRole('heading', {name: '角色详情 · 运营测试角色', exact: true}).waitFor();
  assert.equal(await editor.page.getByRole('button', {name: '发布角色', exact: true}).count(), 0); assert.equal(await db.characterImage.count({where: {characterId: role.id}}), 1);
  checks.push('页面创建草稿、关系值、画廊、表情和配角实际入库');
  await editor.page.getByRole('button', {name: '管理预览', exact: true}).click(); await editor.page.getByRole('region', {name: '角色管理预览'}).waitFor(); assert(await editor.page.getByText('PRIVATE_PERSONA_SYNTHETIC', {exact: true}).isVisible()); assert.equal(await db.aiCall.count(), 0);
  const ordinary = await login(actors[4]); assert.equal((await ordinary.context.request.get(base + '/api/characters/' + role.id, {headers: {Authorization: `Bearer ${ordinary.token}`}})).status(), 403);
  checks.push('管理预览不公开内容、不调用AI；普通用户不可读取私有角色');
  async function selectRole(page) {
    await page.getByLabel('搜索角色', {exact: true}).fill('运营测试角色'); await page.getByRole('button', {name: '搜索角色', exact: true}).click(); await page.getByRole('button', {name: '查看角色 运营测试角色', exact: true}).click(); await page.getByRole('heading', {name: '角色详情 · 运营测试角色', exact: true}).waitFor();
  }
  const publisher = await login(actors[2]); await publisher.page.goto(base + '/admin/characters'); await selectRole(publisher.page); assert.equal(await publisher.page.getByRole('button', {name: '保存角色内容', exact: true}).count(), 0);
  await publisher.page.getByLabel('操作理由', {exact: true}).fill('版权确认后发布'); const publication = publisher.page.waitForResponse(response => response.url().endsWith('/publication') && response.request().method() === 'POST'); await publisher.page.getByRole('button', {name: '发布角色', exact: true}).click(); assert.equal((await publication).status(), 200);
  assert((await (await ordinary.context.request.get(base + '/api/characters')).json()).some(item => item.id === role.id)); checks.push('独立发布角色权限与前台可见性闭环');
  await editor.page.goto(base + '/admin/characters'); await selectRole(editor.page); await editor.page.getByLabel('背景', {exact: true}).fill('公开后修改背景'); await editor.page.getByLabel('操作理由', {exact: true}).fill('修改需要重新审核');
  const editResponse = editor.page.waitForResponse(response => response.url().endsWith('/management/' + role.id) && response.request().method() === 'PUT'); await editor.page.getByRole('button', {name: '保存角色内容', exact: true}).click(); assert.equal((await editResponse).status(), 200);
  assert(!(await (await ordinary.context.request.get(base + '/api/characters')).json()).some(item => item.id === role.id)); checks.push('编辑已公开内容自动撤下并等待重新审核');
  const reader = await login(actors[3]); await reader.page.goto(base + '/admin/characters'); await selectRole(reader.page); assert.equal(await reader.page.getByRole('button', {name: '保存角色内容', exact: true}).count(), 0); assert.equal(await reader.page.getByRole('button', {name: '发布角色', exact: true}).count(), 0); checks.push('角色只读身份无编辑和发布入口');
  await publisher.page.goto(base + '/admin/characters'); await publisher.page.getByLabel('选择角色 运营测试角色', {exact: true}).check(); await publisher.page.getByLabel('批量操作理由', {exact: true}).fill('批量公开验收');
  let batch = publisher.page.waitForResponse(response => response.url().endsWith('/management/publication') && response.request().method() === 'POST'); await publisher.page.getByRole('button', {name: '批量发布角色', exact: true}).click(); assert.equal((await batch).status(), 200); await publisher.page.waitForLoadState('networkidle');
  await publisher.page.getByLabel('选择角色 运营测试角色', {exact: true}).check(); await publisher.page.getByLabel('批量操作理由', {exact: true}).fill('批量下架验收'); batch = publisher.page.waitForResponse(response => response.url().endsWith('/management/publication') && response.request().method() === 'POST'); await publisher.page.getByRole('button', {name: '批量下架角色', exact: true}).click(); assert.equal((await batch).status(), 200); checks.push('角色管理批量公开和下架');
  for (const width of [390, 1280]) {
    await editor.page.setViewportSize({width, height: 900}); await editor.page.goto(base + '/admin/characters'); await selectRole(editor.page); await editor.page.waitForLoadState('networkidle');
    const region = editor.page.getByRole('region', {name: '后台工作区'}); const size = await region.evaluate(element => ({client: element.clientWidth, scroll: element.scrollWidth})); assert(size.scroll <= size.client + 1, `overflow ${width}`); await editor.page.screenshot({path: path.join(out, `characters-${width}.png`)});
  }
  checks.push('角色表格和复杂编辑器390/1280px布局'); assert.deepEqual(errors, []); passed = true; console.log(JSON.stringify({checks, errors, artifacts: out}));
} finally {
  await browser?.close();
  if (app && app.exitCode === null) {if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'}); else app.kill('SIGTERM'); await new Promise(resolve => {if (app.exitCode !== null) resolve(); else app.once('exit', resolve);});}
  await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) await rm(dbPath + suffix, {force: true}); if (passed) await rm(path.join(out, 'server.log'), {force: true});
}
