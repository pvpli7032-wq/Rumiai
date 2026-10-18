import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir,open,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {chromium} from 'playwright';

const stamp=process.pid+'-'+Date.now(),file='payment-orders-browser-'+stamp+'.db',port=18808,base='http://127.0.0.1:'+port,out=path.resolve('artifacts/payment-orders-browser',stamp);
await mkdir(out,{recursive:true});
const env={...process.env,NODE_ENV:'production',DATABASE_URL:'file:./'+file,JWT_SECRET:randomBytes(48).toString('hex'),OPENAI_API_KEY:'',EZFP_ENABLED:'false',EZFP_REFUNDS_ENABLED:'false',DISABLE_MOCK_AI:'true',ALLOW_SIMULATED_PURCHASES:'false',MODERATOR_USER_IDS:'',PAYMENT_ADMIN_USER_IDS:'',NEXT_DIST_DIR:'.next-build',NEXT_PUBLIC_SITE_URL:base};
delete env.RUST_LOG;Object.assign(process.env,env);
const dbPath=path.resolve('prisma',file),empty=await open(dbPath,'wx');await empty.close();
const migrated=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});assert.equal(migrated.status,0,migrated.stdout+migrated.stderr);
const {db,pragmasReady}=await import('../src/lib/db.ts');await pragmasReady;
const {bootstrapOwner,saveOperator}=await import('../src/lib/admin/management-service.ts');
const password=randomBytes(24).toString('hex'),checks=[],errors=[];let app,browser;
try{
  const owner=await db.user.create({data:{username:'orders_browser_owner_'+stamp,email:'orders-owner-'+stamp+'@example.invalid',passwordHash:await bcrypt.hash(password,8)}});
  const finance=await db.user.create({data:{username:'orders_browser_finance_'+stamp,email:'orders-finance-'+stamp+'@example.invalid',passwordHash:await bcrypt.hash(password,8)}});
  await bootstrapOwner(owner.email);
  const role=await db.adminRole.findUniqueOrThrow({where:{code:'FINANCE_VIEWER'}});
  await saveOperator(owner.id,{userId:finance.id,enabled:true,version:0,roleIds:[role.id],reason:'订单浏览器验收财务查看权限'});
  for(let index=0;index<31;index++){
    const user=await db.user.create({data:{username:'orders_buyer_'+stamp+'_'+index,email:'orders-buyer-'+stamp+'-'+index+'@example.invalid',passwordHash:'synthetic'}});
    const suffix=String(index).padStart(3,'0');
    await db.paymentOrder.create({data:{
      orderNo:'OPSORDER-'+suffix,idempotencyKey:randomBytes(16).toString('hex'),userId:user.id,
      packageCoins:60,packageBonus:index,coinAmount:60+index,amountCnyCents:600,
      currency:'CNY',status:index%2?'PAID':'PENDING',providerTradeNo:'OPS-TRADE-'+suffix,
      createdAt:new Date(Date.now()-index*1000),...(index%2?{paidAt:new Date(Date.now()-index*1000)}:{}),
    }});
  }
  const callbackOrder=await db.paymentOrder.findUniqueOrThrow({where:{orderNo:'OPSORDER-007'}});
  await db.paymentCallbackEvent.create({data:{paymentOrderId:callbackOrder.id,provider:'EZFP',providerTradeNo:'OPS-TRADE-007',outcome:'SETTLED'}});
  await db.paymentCallbackEvent.create({data:{paymentOrderId:callbackOrder.id,provider:'EZFP',providerTradeNo:'OPS-TRADE-007',outcome:'REJECTED',reasonCode:'amount_mismatch',receivedAt:new Date(Date.now()+1000)}});
  app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,stdio:'ignore',windowsHide:true});
  let ready=false;
  for(let i=0;i<180;i++){
    if(app.exitCode!==null)throw Error('isolated production server exited');
    try{if((await fetch(base+'/api/finance/orders/all')).status===401){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert(ready,'isolated production server did not become ready');
  browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const login=await context.request.post(base+'/api/auth/login',{data:{email:finance.email,password}});
  assert.equal(login.status(),200);
  const {token}=await login.json();
  await context.addInitScript(value=>localStorage.setItem('khuiai_token',value),token);
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/admin/finance');await page.getByRole('heading',{name:'充值订单',exact:true}).waitFor();
  await page.getByText('共 31 笔 · 第 1 / 2 页',{exact:true}).waitFor();
  const listResponse=await context.request.get(base+'/api/finance/orders/all?page=1&pageSize=25&status=ALL',{headers:{Authorization:'Bearer '+token}});
  assert.equal(listResponse.status(),200);const list=await listResponse.json();assert.equal(list.total,31);assert.equal(list.items.length,25);
  assert.equal(Object.hasOwn(list.items[0],'userId'),false);assert.equal(Object.hasOwn(list.items[0],'providerPayInfo'),false);
  checks.push('财务订单区显示分页快照，接口仅返回运营需要的字段');
  await page.getByLabel('按订单号或渠道单号查找').fill('OPS-TRADE-007');
  await page.getByRole('button',{name:'查询',exact:true}).click();
  await page.locator('tbody').getByText('OPSORDER-007',{exact:false}).waitFor({state:'visible'});
  await page.locator('tbody').getByText('入账 · OPS-TRADE-007',{exact:false}).waitFor({state:'visible'});
  await page.locator('tbody').getByText('业务校验拒绝 · amount_mismatch',{exact:false}).waitFor({state:'visible'});
  assert.equal((await context.request.get(base+'/api/finance/orders/all?q=OPS-TRADE-007',{headers:{Authorization:'Bearer '+token}})).status(),200);
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:/导出 CSV/}).click()]);
  const csv=await readFile(await download.path(),'utf8');assert(csv.includes('OPSORDER-007'));assert(csv.includes('OPS-TRADE-007'));assert.equal(csv.includes('providerPayInfo'),false);
  checks.push('订单号与渠道单号搜索返回匹配订单、展示入账与已验签拒绝原因，并按当前筛选导出 CSV');
  await page.getByLabel('按订单号或渠道单号查找').fill('');
  await page.getByRole('button',{name:'查询',exact:true}).click();
  await page.getByRole('button',{name:'下一页',exact:true}).click();
  await page.getByText('共 31 笔 · 第 2 / 2 页',{exact:true}).waitFor();
  checks.push('筛选及分页状态正确推进');
  await page.setViewportSize({width:390,height:844});await page.reload();
  await page.getByRole('heading',{name:'充值订单',exact:true}).waitFor();
  await page.getByLabel('按订单号或渠道单号查找').fill('OPS-TRADE-007');
  await page.getByRole('button',{name:'查询',exact:true}).click();
  await page.getByText('已验签回调 业务校验拒绝 · amount_mismatch',{exact:false}).waitFor({state:'visible'});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.getByRole('heading',{name:'充值订单',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'payment-orders-mobile.png')});
  assert.deepEqual(errors,[]);
  checks.push('财务订单区390px无横向溢出且无页面异常');
  await writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,checks,database:file,providerCalled:false,refundSubmitted:false},null,2));
}finally{
  await browser?.close();
  if(app&&app.exitCode===null){app.kill();await new Promise(resolve=>app.once('exit',resolve));}
  await db.$disconnect();
  for(const suffix of ['','-wal','-shm','-journal'])await rm(path.resolve('prisma',file+suffix),{force:true});
}

