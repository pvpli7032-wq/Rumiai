import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir,open,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {chromium} from 'playwright';
import {createIsolatedDatabase} from './helpers/create-isolated-db.mjs';

const stamp=`${process.pid}-${Date.now()}`,file=`compliance-browser-${stamp}.db`,port=18812,base=`http://127.0.0.1:${port}`,out=path.resolve('artifacts/compliance-browser',stamp),distDir=process.env.ISOLATED_BUILD_DIR?.trim()||process.env.NEXT_DIST_DIR?.trim()||'.next-build';
await mkdir(out,{recursive:true});
// 旧默认指向 .next-validation-build（verify:build 的产物）。那是一次性校验输出，跑完之后不清除，
// 一旦残留且源码已变（例如会话存储键改名），这里会拿过期产物起服务：页面能打开但登录态不生效，
// 排查成本很高。默认与其余浏览器脚本一致，直接用当前生产构建；需要测特定产物时显式传 ISOLATED_BUILD_DIR。
if(!existsSync(path.join(distDir,'BUILD_ID')))throw new Error(`构建产物缺失或不完整：${distDir}/BUILD_ID 不存在，先执行 npm run build。`);
const env={...process.env,NODE_ENV:'production',DATABASE_URL:`file:./${file}`,JWT_SECRET:randomBytes(48).toString('hex'),OPENAI_API_KEY:'',EZFP_ENABLED:'false',EZFP_REFUNDS_ENABLED:'false',DISABLE_MOCK_AI:'true',ALLOW_SIMULATED_PURCHASES:'false',MODERATOR_USER_IDS:'',PAYMENT_ADMIN_USER_IDS:'',NEXT_DIST_DIR:distDir,NEXT_PUBLIC_SITE_URL:base};delete env.RUST_LOG;Object.assign(process.env,env);
const dbPath=path.resolve('prisma',file)
await createIsolatedDatabase(dbPath);
const {db,pragmasReady}=await import('../src/lib/db.ts');await pragmasReady;
const {bootstrapOwner,saveOperator}=await import('../src/lib/admin/management-service.ts');
const password=randomBytes(24).toString('hex'),errors=[];let app,browser;
try{
  const owner=await db.user.create({data:{username:`compliance_owner_${stamp}`,email:`compliance-owner-${stamp}@example.invalid`,passwordHash:await bcrypt.hash(password,8)}});
  const manager=await db.user.create({data:{username:`compliance_manager_${stamp}`,email:`compliance-manager-${stamp}@example.invalid`,passwordHash:await bcrypt.hash(password,8)}});
  const reader=await db.user.create({data:{username:`compliance_reader_${stamp}`,email:`compliance-reader-${stamp}@example.invalid`,passwordHash:await bcrypt.hash(password,8)}});
  await bootstrapOwner(owner.email);const managerRole=await db.adminRole.findUniqueOrThrow({where:{code:'COMPLIANCE_MANAGER'}});
  const readRole=await db.adminRole.create({data:{code:`COMPLIANCE_READER_${stamp}`,name:'合规只读验收',permissions:{create:[{permission:'compliance.read'}]}}});
  await saveOperator(owner.id,{userId:manager.id,enabled:true,version:0,roleIds:[managerRole.id],reason:'合规管理端浏览器验收'});
  await saveOperator(owner.id,{userId:reader.id,enabled:true,version:0,roleIds:[readRole.id],reason:'合规只读权限边界验收'});
  let serverOutput='';app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});app.stdout.on('data',chunk=>{serverOutput+=chunk.toString();});app.stderr.on('data',chunk=>{serverOutput+=chunk.toString();});
  let ready=false,probe='no response';for(let index=0;index<120;index++){if(app.exitCode!==null)throw Error(`isolated production server exited: ${serverOutput}`);try{const response=await fetch(base+'/api/compliance/registration-policy');probe=`${response.status} ${response.url} ${(await response.text()).slice(0,300)}`;if(response.status===200){ready=true;break;}}catch(error){probe=String(error);}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready,`isolated production server did not serve the compliance endpoint (last probe: ${probe}): ${serverOutput}`);
  browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-CN'});
  async function login(user){const response=await context.request.post(base+'/api/auth/login',{data:{email:user.email,password}});assert.equal(response.status(),200);return (await response.json()).token;}
  const managerToken=await login(manager);await context.addInitScript(value=>localStorage.setItem('xingban_token',value),managerToken);
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(base+'/admin/compliance');
  await page.getByRole('heading',{name:'注册确认要求'}).waitFor();assert.equal(await page.getByRole('spinbutton',{name:'最低年龄'}).inputValue(),'');
  await page.getByLabel('要求注册者确认达到最低年龄').check();await page.getByRole('spinbutton',{name:'最低年龄'}).fill('18');await page.getByLabel('年龄政策版本').fill('age-browser-1');await page.getByLabel('服务条款版本').fill('terms-browser-1');await page.getByLabel('隐私政策版本').fill('privacy-browser-1');await page.getByLabel('变更理由').fill('隔离浏览器测试配置');
  const savedResponse=page.waitForResponse(response=>response.request().method()==='PATCH'&&response.url().endsWith('/api/admin/compliance'));
  await page.getByRole('button',{name:'保存设置'}).click();const saved=await savedResponse;assert.equal(saved.status(),200,await saved.text());await page.getByText('合规要求已保存并写入管理审计。').waitFor();
  const publicPolicyResponse=await context.request.get(base+'/api/compliance/registration-policy');assert.equal(publicPolicyResponse.status(),200);const publicPolicy=await publicPolicyResponse.json();assert.deepEqual(publicPolicy,{ageGate:{enabled:true,minimumAge:18,version:'age-browser-1'},termsVersion:'terms-browser-1',privacyVersion:'privacy-browser-1'});
  const missing=await context.request.post(base+'/api/auth/register',{data:{name:'拒绝确认',email:`consent-missing-${stamp}@example.invalid`,password:'Local123'}});assert.equal(missing.status(),400);
  const register=await context.newPage();register.on('pageerror',error=>errors.push(error.message));await register.goto(base+'/register');await register.getByRole('heading').first().waitFor();
  await register.locator('form input[type="text"]').fill(`consent_browser_${stamp}`);await register.locator('form input[type="email"]').fill(`consent-browser-${stamp}@example.invalid`);await register.locator('form input[type="password"]').fill('Local123');
  const checks=register.getByRole('checkbox');assert.equal(await checks.count(),3);await checks.nth(0).check();await checks.nth(1).check();await checks.nth(2).check();
  const registrationResponse=register.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/api/auth/register'));
  await register.locator('form button[type="submit"]').click();const registered=await registrationResponse;assert.equal(registered.status(),201,await registered.text());const {user}=await registered.json();
  const consentRows=await db.userConsent.findMany({where:{userId:user.id},orderBy:{policyType:'asc'}});assert.deepEqual(consentRows.map(row=>[row.policyType,row.policyVersion,row.source]),[['AGE','age-browser-1','REGISTER'],['PRIVACY','privacy-browser-1','REGISTER'],['TERMS','terms-browser-1','REGISTER']]);
  const ownerHeaders={Authorization:'Bearer '+managerToken};const adminRead=await context.request.get(base+'/api/admin/compliance',{headers:ownerHeaders});assert.equal(adminRead.status(),200);assert.equal((await adminRead.json()).consentCounts.length,3);
  const readerToken=await login(reader);const readerHeaders={Authorization:'Bearer '+readerToken};assert.equal((await context.request.get(base+'/api/admin/compliance',{headers:readerHeaders})).status(),200);const forbidden=await context.request.patch(base+'/api/admin/compliance',{headers:{...readerHeaders,'Content-Type':'application/json'},data:{ageGateEnabled:false,minimumAge:null,agePolicyVersion:null,termsVersion:null,privacyVersion:null,version:1,reason:'只读账号越权测试'}});assert.equal(forbidden.status(),403);
  const readerContext=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-CN'});await readerContext.addInitScript(value=>localStorage.setItem('xingban_token',value),readerToken);const readerPage=await readerContext.newPage();readerPage.on('pageerror',error=>errors.push(error.message));await readerPage.goto(base+'/admin/compliance');await readerPage.getByRole('heading',{name:'注册确认要求'}).waitFor();assert.equal(await readerPage.getByRole('button',{name:'保存设置'}).isEnabled(),false);await readerPage.getByText('当前账号只有查看权限，设置不可修改。').waitFor();await readerContext.close();
  await page.evaluate(value=>localStorage.setItem('xingban_token',value),managerToken);await page.setViewportSize({width:390,height:844});await page.goto(base+'/admin/compliance');await page.getByRole('heading',{name:'注册确认要求'}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,'compliance-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);await writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,checks:['管理端加载默认关闭策略','管理端保存年龄/条款版本及审计理由','公开接口仅暴露注册要求版本','API缺失确认拒绝且不注册','注册页出现必需确认并创建用户','同事务记录年龄/条款/隐私确认版本','只读合规角色可查不可改','390px布局无横向溢出和页面异常'],database:file,providerCalled:false},null,2));
}finally{
  await browser?.close();if(app&&app.exitCode===null){app.kill();await new Promise(resolve=>app.once('exit',resolve));}await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])await rm(path.resolve('prisma',file+suffix),{force:true});
}
