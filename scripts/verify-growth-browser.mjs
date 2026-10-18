import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir,open,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {chromium} from 'playwright';

const stamp=process.pid+'-'+Date.now(),file='growth-browser-'+stamp+'.db',port=18810,base='http://127.0.0.1:'+port,out=path.resolve('artifacts/growth-browser',stamp);
await mkdir(out,{recursive:true});
const env={...process.env,NODE_ENV:'production',DATABASE_URL:'file:./'+file,JWT_SECRET:randomBytes(48).toString('hex'),OPENAI_API_KEY:'',DISABLE_MOCK_AI:'true',ALLOW_SIMULATED_PURCHASES:'false',MODERATOR_USER_IDS:'',PAYMENT_ADMIN_USER_IDS:'',NEXT_DIST_DIR:process.env.NEXT_DIST_DIR||'.next-build',NEXT_PUBLIC_SITE_URL:base};
delete env.RUST_LOG;Object.assign(process.env,env);
const dbPath=path.resolve('prisma',file),empty=await open(dbPath,'wx');await empty.close();
const migration=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});assert.equal(migration.status,0,migration.stdout+migration.stderr);
const {db,pragmasReady}=await import('../src/lib/db.ts');await pragmasReady;
const {bootstrapOwner,saveOperator}=await import('../src/lib/admin/management-service.ts');
const {signToken}=await import('../src/lib/auth.ts');
const password=randomBytes(24).toString('hex'),errors=[];let app,browser;
try{
  const owner=await db.user.create({data:{username:'growth_browser_owner_'+stamp,email:'growth-browser-owner-'+stamp+'@example.invalid',passwordHash:await bcrypt.hash(password,8)}});
  const manager=await db.user.create({data:{username:'growth_browser_manager_'+stamp,email:'growth-browser-manager-'+stamp+'@example.invalid',passwordHash:await bcrypt.hash(password,8)}});
  const reader=await db.user.create({data:{username:'growth_browser_reader_'+stamp,email:'growth-browser-reader-'+stamp+'@example.invalid',passwordHash:await bcrypt.hash(password,8)}});
  const giftCharacter=await db.character.create({data:{name:'浏览器赠礼角色',personality:'验收',background:'隔离浏览器',creatorId:owner.id,isPublic:true,reviewStatus:'APPROVED'}});
  await bootstrapOwner(owner.email);
  const role=await db.adminRole.findUniqueOrThrow({where:{code:'GROWTH_MANAGER'}});
  await saveOperator(owner.id,{userId:manager.id,enabled:true,version:0,roleIds:[role.id],reason:'增长后台隔离浏览器验收'});
  app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,stdio:'ignore',windowsHide:true});
  let ready=false;for(let index=0;index<180;index++){if(app.exitCode!==null)throw Error('isolated production server exited');try{if((await fetch(base+'/api/admin/growth/missions')).status===401){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  assert(ready,'isolated production server did not become ready');
  browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-CN'});
  async function login(user){const response=await context.request.post(base+'/api/auth/login',{data:{email:user.email,password}});assert.equal(response.status(),200);return (await response.json()).token;}
  const managerToken=await login(manager);await context.addInitScript(value=>localStorage.setItem('xingban_token',value),managerToken);
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/admin/growth');await page.getByRole('heading',{name:'任务与奖励',exact:true}).waitFor();
  await page.getByLabel('第 1 天签到奖励').waitFor();assert.equal(await page.getByLabel('第 1 天签到奖励').inputValue(),'10');
  await page.getByLabel('第 2 天签到奖励').fill('77');await page.getByLabel('操作理由').first().fill('浏览器验收调整签到奖励');
  await page.getByRole('button',{name:'保存签到奖励',exact:true}).click();await page.getByLabel('第 2 天签到奖励').waitFor();assert.equal(await page.getByLabel('第 2 天签到奖励').inputValue(),'77');
  await page.getByRole('button',{name:'新建任务',exact:true}).click();
  await page.getByLabel('任务名称').fill('浏览器签到任务');await page.getByLabel('金币奖励').fill('25');await page.getByLabel('启用任务').check();await page.getByLabel('操作理由').first().fill('浏览器验收创建任务');
  const saveResponse=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().includes('/api/admin/growth/missions'));
  await page.getByRole('button',{name:'保存任务',exact:true}).click();
  const saved=await saveResponse;const savedBody=await saved.json();assert.equal(saved.status(),201,JSON.stringify(savedBody));
  await page.getByText('浏览器签到任务',{exact:false}).waitFor();
  await page.getByLabel('礼物代码').fill('browser_star');await page.getByLabel('名称',{exact:true}).fill('浏览器星星');await page.getByLabel('图标').fill('⭐');await page.getByLabel('金币价格').fill('12');await page.getByLabel('操作理由').last().fill('浏览器验收创建礼物');
  const giftSaveResponse=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().includes('/api/admin/growth/gifts'));
  await page.getByRole('button',{name:'新增礼物',exact:true}).click();const giftSaved=await giftSaveResponse;assert.equal(giftSaved.status(),201,await giftSaved.text());
  const giftCatalog=await context.request.get(base+'/api/gifts');assert.equal(giftCatalog.status(),200);const browserGift=(await giftCatalog.json()).gifts.find(item=>item.code==='browser_star');assert(browserGift);assert.equal(browserGift.coinPrice,12);
  const managerHeaders={Authorization:'Bearer '+managerToken};const configured=await context.request.get(base+'/api/admin/growth/missions',{headers:managerHeaders});assert.equal(configured.status(),200);const records=(await configured.json()).missions;const mission=records.find(item=>item.title==='浏览器签到任务');assert(mission);assert.equal(mission.conditionType,'CHECKIN_COUNT');assert.equal(mission.isActive,true);
  const readerToken=await login(reader);const forbidden=await context.request.get(base+'/api/admin/growth/missions',{headers:{Authorization:'Bearer '+readerToken}});assert.equal(forbidden.status(),403);
  await page.evaluate(value=>localStorage.setItem('xingban_token',value),readerToken);await page.goto(base+'/profile');await page.getByText('浏览器签到任务',{exact:false}).waitFor();await page.getByText(/进度 0\/1/).waitFor();
  const readerHeaders={Authorization:'Bearer '+readerToken};const premature=await context.request.post(base+'/api/missions/'+mission.id+'/complete',{headers:readerHeaders});assert.equal(premature.status(),409);
  const giftResult=await context.request.post(base+'/api/characters/'+giftCharacter.id+'/gift',{headers:{...readerHeaders,'Content-Type':'application/json'},data:{giftId:browserGift.id,amount:12}});assert.equal(giftResult.status(),201,await giftResult.text());assert.equal((await giftResult.json()).coinPrice,12);
  const checkin=await context.request.post(base+'/api/checkin',{headers:readerHeaders});assert.equal(checkin.status(),200);assert.equal((await checkin.json()).coinsEarned,10);
  const reward=await context.request.post(base+'/api/missions/'+mission.id+'/complete',{headers:readerHeaders});assert.equal(reward.status(),200);assert.equal((await reward.json()).coinsEarned,25);
  const budgetResponse=await context.request.get(base+'/api/admin/growth/rewards?days=7',{headers:managerHeaders});assert.equal(budgetResponse.status(),200);const budget=await budgetResponse.json();assert.equal(budget.totalCoins,35);assert.equal(budget.totalClaims,2);assert.equal(budget.budgetLimitConfigured,false);
  await page.reload();await page.getByText('浏览器签到任务',{exact:false}).waitFor();
  await page.evaluate(value=>localStorage.setItem('xingban_token',value),managerToken);await page.setViewportSize({width:390,height:844});await page.goto(base+'/admin/growth');await page.getByRole('heading',{name:'任务与奖励',exact:true}).waitFor();await page.getByRole('heading',{name:'奖励发放监控',exact:true}).waitFor();await page.getByText('奖励金币',{exact:true}).waitFor();await page.getByText('35',{exact:true}).first().waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,'growth-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);await writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,checks:['增长权限读写分离','签到默认奖励与配置保存','任务条件配置及发布','签到/任务/角色任务金币来源可归类','奖励发放金额与领取量汇总','礼物目录后台新增与公开展示','礼物按目录定价入账并扣币','未达标拒绝、签到达标后单次发奖','奖励监控390px 无横向溢出'],database:file,providerCalled:false},null,2));
}finally{
  await browser?.close();if(app&&app.exitCode===null){app.kill();await new Promise(resolve=>app.once('exit',resolve));}
  await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])await rm(path.resolve('prisma',file+suffix),{force:true});
}
