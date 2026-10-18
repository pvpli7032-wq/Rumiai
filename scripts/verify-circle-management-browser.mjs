import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir, open, rm} from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {chromium} from 'playwright';

const stamp = `${process.pid}-${Date.now()}`, file = `circle-browser-${stamp}.db`, base = 'http://127.0.0.1:18801';
const out = path.resolve('artifacts/circle-management-browser', stamp); await mkdir(out, {recursive: true});
const env = {...process.env, NODE_ENV: 'production', DATABASE_URL: `file:./${file}`, UPLOADS_DIRECTORY: path.join(out, 'uploads'), JWT_SECRET: randomBytes(48).toString('hex'), OPENAI_API_KEY: '', EZFP_ENABLED: 'false', EZFP_REFUNDS_ENABLED: 'false', DISABLE_MOCK_AI: 'true', ALLOW_SIMULATED_PURCHASES: 'false', MODERATOR_USER_IDS: '', PAYMENT_ADMIN_USER_IDS: '', NEXT_DIST_DIR: '.next-build', NEXT_PUBLIC_SITE_URL: base}; delete env.RUST_LOG;
Object.assign(process.env, env); const dbPath = path.resolve('prisma', file), empty = await open(dbPath, 'wx'); await empty.close();
const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {env, encoding: 'utf8', windowsHide: true}); assert.equal(migrated.status, 0, 'isolated migration failed');
const {db, pragmasReady} = await import('../src/lib/db.ts'); await pragmasReady;
const {bootstrapOwner, saveRole, saveOperator} = await import('../src/lib/admin/management-service.ts');
const password = randomBytes(24).toString('hex'), actors = [], checks = [], errors = [];
let app, browser, passed = false;
try {
  for (const name of ['owner', 'reader', 'member-manager', 'ordinary']) actors.push(await db.user.create({data: {username: `${name}_${stamp}`, email: `${name}-${stamp}@example.invalid`, passwordHash: await bcrypt.hash(password, 10)}}));
  await bootstrapOwner(actors[0].email);
  for (const [index, permissions] of [[1, ['community.read']], [2, ['community.read', 'community.members.manage']]]) {
    const role = await saveRole(actors[0].id, {name: actors[index].username, permissions, reason: '合成浏览器权限'});
    await saveOperator(actors[0].id, {userId: actors[index].id, roleIds: [role.id], version: 0, enabled: true, reason: '合成运营身份'});
  }
  const log = await open(path.join(out, 'server.log'), 'a');
  try {app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '18801'], {env, stdio: ['ignore', log.fd, log.fd], windowsHide: true});} finally {await log.close();}
  let ready = false;
  for (let i = 0; i < 150; i++) {if (app.exitCode !== null) throw Error('owned server exited'); try {if ((await fetch(base + '/api/admin/circles')).status === 401) {ready = true; break;}} catch {} await new Promise(resolve => setTimeout(resolve, 100));}
  assert(ready); browser = await chromium.launch();
  async function login(actor) {
    const context = await browser.newContext({viewport: {width: 1280, height: 900}});
    const response = await context.request.post(base + '/api/auth/login', {data: {email: actor.email, password}}); assert.equal(response.status(), 200);
    const {token} = await response.json(); await context.addInitScript(value => localStorage.setItem('xingban_token', value), token);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => void dialog.accept());
    return {context, page, token, headers: {Authorization: `Bearer ${token}`}};
  }
  const owner = await login(actors[0]); await owner.page.goto(base + '/admin');
  await owner.page.getByRole('navigation', {name: '后台导航'}).getByRole('link', {name: '圈子与成员', exact: true}).click();
  await owner.page.getByRole('button', {name: '新增站点圈子', exact: true}).click();
  const name = '运营测试圈子';
  await owner.page.getByLabel('管理圈子名称', {exact: true}).fill(name);
  await owner.page.getByLabel('管理圈子介绍', {exact: true}).fill('站点圈子合成介绍。'.repeat(35));
  await owner.page.getByLabel('管理圈子标签', {exact: true}).fill('原创,治愈');
  await owner.page.getByLabel('圈子操作理由', {exact: true}).fill('浏览器创建站点圈子');
  let response = owner.page.waitForResponse(r => r.url().endsWith('/api/circles/management') && r.request().method() === 'POST');
  await owner.page.getByRole('button', {name: '创建站点圈子', exact: true}).click(); const created = await response; assert.equal(created.status(), 201); const circle = await created.json(); assert.equal(circle.ownerId, null); assert.equal(circle.status, 'HIDDEN');
  assert.equal((await owner.context.request.get(base + '/api/circles/' + circle.id)).status(), 404);
  checks.push('站点圈子实际创建，独立归属且未公开');
  async function circleAction(action, reason) {
    await owner.page.getByLabel('圈子操作理由', {exact: true}).fill(reason);
    const result = owner.page.waitForResponse(r => r.url().endsWith('/management/' + circle.id) && r.request().method() === 'PATCH');
    await owner.page.getByRole('button', {name: action, exact: true}).click(); assert.equal((await result).status(), 200);
    await owner.page.waitForLoadState('networkidle');
  }
  await circleAction('恢复公开', '明确公开合成圈子'); await circleAction('推荐圈子', '前台推荐验收');
  const publicContext = await browser.newContext({viewport: {width: 1280, height: 900}}), publicPage = await publicContext.newPage(); publicPage.on('pageerror', error => errors.push(error.message));
  await publicPage.goto(base + '/circles'); await publicPage.getByText('创建者：站点', {exact: false}).waitFor(); assert(await publicPage.getByText('推荐', {exact: true}).isVisible());
  await publicPage.goto(base + '/circles/' + circle.id); await publicPage.getByRole('heading', {name, exact: true}).waitFor();
  await circleAction('隐藏圈子', '下架联动验收'); assert.equal((await publicContext.request.get(base + '/api/circles/' + circle.id)).status(), 404);
  await circleAction('恢复公开', '继续成员验收'); checks.push('公开、推荐、隐藏与前台详情真实联动');
  await owner.page.getByLabel('管理圈子介绍', {exact: true}).fill('通过页面保存的圈子介绍');
  await circleAction('保存圈子内容', '内容编辑验收');
  assert.equal((await db.circle.findUnique({where: {id: circle.id}})).description, '通过页面保存的圈子介绍');
  assert.equal((await (await publicContext.request.get(base + '/api/circles/' + circle.id)).json()).description, '通过页面保存的圈子介绍');
  checks.push('后台内容编辑实际保存并同步前台');
  const draft = '并发冲突时保留的本地草稿';
  await owner.page.getByLabel('管理圈子介绍', {exact: true}).fill(draft);
  const snapshot = await (await owner.context.request.get(base + '/api/admin/circles/' + circle.id, {headers: owner.headers})).json();
  const concurrent = await owner.context.request.patch(base + '/api/admin/circles/' + circle.id, {headers: owner.headers, data: {action: 'SAVE', updatedAt: snapshot.updatedAt, reason: '合成并发编辑', content: {name, description: '另一个运营保存的版本', tags: '原创,治愈', universeId: null}}}); assert.equal(concurrent.status(), 200);
  await owner.page.getByLabel('圈子操作理由', {exact: true}).fill('拒绝旧版本覆盖');
  const stale = owner.page.waitForResponse(r => r.url().endsWith('/management/' + circle.id) && r.request().method() === 'PATCH');
  await owner.page.getByRole('button', {name: '保存圈子内容', exact: true}).click(); assert.equal((await stale).status(), 409);
  assert.equal(await owner.page.getByLabel('管理圈子介绍', {exact: true}).inputValue(), draft);
  await owner.page.getByRole('button', {name: '重新读取详情', exact: true}).click();
  await owner.page.getByRole('status').filter({hasText: '详情已重新读取。'}).waitFor();
  assert.equal(await owner.page.getByLabel('管理圈子介绍', {exact: true}).inputValue(), '另一个运营保存的版本');
  checks.push('并发版本拒绝覆盖、保留草稿并由用户明确刷新');
  const ordinary = await login(actors[3]); assert.equal((await ordinary.context.request.get(base + '/api/admin/circles', {headers: ordinary.headers})).status(), 403);
  const join = () => ordinary.context.request.put(base + '/api/circles/' + circle.id + '/subscription', {headers: ordinary.headers});
  assert.equal((await join()).status(), 200);
  async function selectCircle(page) {
    await page.goto(base + '/admin/circles'); await page.getByLabel('搜索管理圈子', {exact: true}).fill(name); await page.getByRole('button', {name: '搜索圈子', exact: true}).click();
    await page.getByRole('button', {name: '查看圈子 ' + name, exact: true}).click(); await page.getByRole('heading', {name: '圈子详情 · ' + name, exact: true}).waitFor();
  }
  const memberManager = await login(actors[2]); await selectCircle(memberManager.page);
  assert.equal(await memberManager.page.getByRole('button', {name: '保存圈子内容', exact: true}).count(), 0);
  async function memberAction(action) {
    await memberManager.page.getByRole('button', {name: action + ' ' + actors[3].username, exact: true}).click();
    await memberManager.page.getByLabel('成员处置理由', {exact: true}).fill('合成成员处置');
    const result = memberManager.page.waitForResponse(r => r.url().endsWith('/members/' + actors[3].id) && r.request().method() === 'PATCH');
    await memberManager.page.getByRole('button', {name: '确认' + action, exact: true}).click(); assert.equal((await result).status(), 200); await memberManager.page.waitForLoadState('networkidle');
  }
  await memberAction('限制加入'); assert.equal((await join()).status(), 403);
  await memberManager.page.getByLabel('圈子成员状态', {exact: true}).selectOption('BLOCKED'); await memberAction('解除限制');
  assert.equal(await db.circleMember.count({where: {circleId: circle.id, userId: actors[3].id}}), 0); assert.equal((await join()).status(), 200);
  await memberManager.page.getByLabel('圈子成员状态', {exact: true}).selectOption('MEMBER'); await memberAction('移除成员'); assert.equal((await join()).status(), 200);
  checks.push('独立成员权限、限制防重入、解除需自行加入、移除可重入');
  const reader = await login(actors[1]); await selectCircle(reader.page);
  assert.equal(await reader.page.getByRole('button', {name: '新增站点圈子', exact: true}).count(), 0); assert.equal(await reader.page.getByRole('button', {name: '隐藏圈子', exact: true}).count(), 0);
  assert.equal(await reader.page.getByRole('button', {name: /限制加入 /}).count(), 0); checks.push('普通用户拒绝管理，只读身份无内容和成员写入口');
  for (const width of [390, 1280]) {
    await owner.page.setViewportSize({width, height: 900}); await selectCircle(owner.page); await owner.page.waitForLoadState('networkidle');
    const region = owner.page.getByRole('region', {name: '后台工作区'}); assert(await region.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    const memberSearch = await owner.page.getByLabel('搜索圈子成员', {exact: true}).boundingBox(); assert(memberSearch && memberSearch.width >= 160, `member search width ${width}`);
    await owner.page.screenshot({path: path.join(out, `circles-${width}.png`)});
    await owner.page.getByRole('heading', {name: '成员与加入限制', exact: true}).evaluate(element => element.scrollIntoView({block: 'start'})); await owner.page.screenshot({path: path.join(out, `members-${width}.png`)});
  }
  checks.push('圈子编辑及成员管理390/1280px布局'); assert.deepEqual(errors, []); passed = true; console.log(JSON.stringify({checks, errors, artifacts: out}));
} finally {
  await browser?.close();
  if (app && app.exitCode === null) {if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'}); else app.kill('SIGTERM'); await new Promise(resolve => {if (app.exitCode !== null) resolve(); else app.once('exit', resolve);});}
  await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) await rm(dbPath + suffix, {force: true}); await rm(path.join(out, 'server.log'), {force: true});
}
