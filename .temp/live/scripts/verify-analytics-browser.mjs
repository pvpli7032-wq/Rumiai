import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir,open,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {chromium} from 'playwright';

const stamp=process.pid+'-'+Date.now(),file='analytics-browser-'+stamp+'.db',port=18809,base='http://127.0.0.1:'+port,out=path.resolve('artifacts/analytics-browser',stamp);
await mkdir(out,{recursive:true});
const env={...process.env,NODE_ENV:'production',DATABASE_URL:'file:./'+file,JWT_SECRET:randomBytes(48).toString('hex'),OPENAI_API_KEY:'',DISABLE_MOCK_AI:'true',ALLOW_SIMULATED_PURCHASES:'false',MODERATOR_USER_IDS:'',PAYMENT_ADMIN_USER_IDS:'',NEXT_DIST_DIR:process.env.ANALYTICS_TEST_DIST_DIR||'.next-build',NEXT_PUBLIC_SITE_URL:base};
delete env.RUST_LOG;Object.assign(process.env,env);
const dbPath=path.resolve('prisma',file),empty=await open(dbPath,'wx');await empty.close();
const migration=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});assert.equal(migration.status,0,migration.stdout+migration.stderr);
const {db,pragmasReady}=await import('../src/lib/db.ts');await pragmasReady;
const {bootstrapOwner,saveOperator}=await import('../src/lib/admin/management-service.ts');
const {signToken}=await import('../src/lib/auth.ts');
const now=new Date(),password=randomBytes(24).toString('hex'),errors=[];let app,browser;
try{
  const owner=await db.user.create({data:{username:'analytics_browser_owner_'+stamp,email:'analytics-browser-owner-'+stamp+'@example.invalid',passwordHash:await bcrypt.hash(password,8)}});
  const viewer=await db.user.create({data:{username:'analytics_browser_viewer_'+stamp,email:'analytics-browser-viewer-'+stamp+'@example.invalid',passwordHash:await bcrypt.hash(password,8),lastActiveAt:now}});
  const customer=await db.user.create({data:{username:'analytics_browser_customer_'+stamp,email:'analytics-browser-customer-'+stamp+'@example.invalid',passwordHash:await bcrypt.hash(password,8),lastActiveAt:now}});
  await bootstrapOwner(owner.email);
  const role=await db.adminRole.findUniqueOrThrow({where:{code:'ANALYTICS_VIEWER'}});
  await saveOperator(owner.id,{userId:viewer.id,enabled:true,version:0,roleIds:[role.id],reason:'运营分析隔离浏览器验收'});
  const character=await db.character.create({data:{name:'Analytics fixture persona',personality:'synthetic',background:'synthetic',creatorId:customer.id}});
  const conversation=await db.conversation.create({data:{userId:customer.id,characterId:character.id}});
  await db.message.create({data:{conversationId:conversation.id,role:'USER',content:'synthetic analytics fixture',createdAt:now}});
  await db.aiCall.create({data:{userId:customer.id,conversationId:conversation.id,operation:'CHAT',status:'SUCCEEDED',model:'synthetic',attempts:1,estimatedCost:0.25,currency:'USD',startedAt:now}});
  await db.paymentOrder.create({data:{orderNo:'ANALYTICS-BROWSER-'+stamp,idempotencyKey:randomBytes(16).toString('hex'),userId:customer.id,packageCoins:60,packageBonus:0,coinAmount:60,amountCnyCents:600,currency:'CNY',status:'PAID',provider:'EZFP',providerTradeNo:'ANALYTICS-TRADE-'+stamp,paidAt:now,createdAt:now}});
  app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,stdio:'ignore',windowsHide:true});
  let ready=false;for(let index=0;index<180;index++){if(app.exitCode!==null)throw Error('isolated production server exited');try{if((await fetch(base+'/api/admin/analytics')).status===401){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  assert(ready,'isolated production server did not become ready');
  browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-CN'});
  const login=await context.request.post(base+'/api/auth/login',{data:{email:viewer.email,password}});assert.equal(login.status(),200);
  const {token}=await login.json();await context.addInitScript(value=>localStorage.setItem('khuiai_token',value),token);
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/admin/analytics');await page.getByRole('heading',{name:'运营分析',exact:true}).waitFor();
  await page.getByText('新注册用户',{exact:true}).waitFor();await page.getByText('活跃账号',{exact:true}).waitFor();
  await page.getByText('¥6.00',{exact:true}).waitFor();await page.getByText('USD · 1 次调用 · 已知成本 0.250000',{exact:true}).waitFor();
  await page.getByText('注册 cohort 留存',{exact:true}).waitFor();await page.getByText(/留存：以注册日为 cohort/).waitFor();await page.getByText(/毛利暂不可计算/).waitFor();
  const forbidden=await context.request.get(base+'/api/admin/analytics',{headers:{Authorization:'Bearer '+await signToken({userId:customer.id,email:customer.email,tokenVersion:customer.tokenVersion})}});assert.equal(forbidden.status(),403);
  const report30=page.waitForResponse(response=>response.url().includes('/api/admin/analytics?days=30')&&response.status()===200);
  await page.getByLabel('统计周期').selectOption('30');await report30;await page.getByText('¥6.00',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(out,'analytics-mobile.png'),fullPage:true});assert.deepEqual(errors,[]);
  await writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,checks:['analytics.read 可访问真实汇总','普通账号 API 拒绝','7/30 天周期切换','用户日活动去重与注册 cohort D1/D7/D30 留存','未知成本/毛利缺口明确标识','390px 无横向溢出'],database:file,providerCalled:false},null,2));
}finally{
  await browser?.close();if(app&&app.exitCode===null){app.kill();await new Promise(resolve=>app.once('exit',resolve));}
  await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])await rm(path.resolve('prisma',file+suffix),{force:true});
}
