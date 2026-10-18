import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir,open,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {PrismaClient} from '@prisma/client';
import {chromium} from 'playwright';

const stamp=`${process.pid}-${Date.now()}`,file=`admin-browser-${stamp}.db`;
const out=path.resolve('artifacts/admin-browser',stamp),base='http://127.0.0.1:18799';
await mkdir(out,{recursive:true});
const env={...process.env,NODE_ENV:'production',DATABASE_URL:`file:./${file}`,JWT_SECRET:randomBytes(48).toString('hex'),OPENAI_API_KEY:'',EZFP_ENABLED:'false',EZFP_REFUNDS_ENABLED:'false',DISABLE_MOCK_AI:'true',ALLOW_SIMULATED_PURCHASES:'false',AI_BUDGET_CIRCUIT_BREAKER:'false',NEXT_DIST_DIR:'.next-build',NEXT_PUBLIC_SITE_URL:base};delete env.RUST_LOG;
const dbPath=path.resolve('prisma',file);const empty=await open(dbPath,'wx');await empty.close();
const migration=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});
assert.equal(migration.status,0,'isolated migration failed');
const db=new PrismaClient({datasources:{db:{url:`file:${dbPath.split(path.sep).join('/')}`}},log:[]});
const password=randomBytes(24).toString('hex'),actors=[];
try{for(let i=0;i<4;i++)actors.push(await db.user.create({data:{username:`admin_browser_${i}_${stamp}`,email:`admin-${i}-${stamp}@example.invalid`,passwordHash:await bcrypt.hash(password,10)}}));
 await db.character.create({data:{creatorId:actors[0].id,name:'布局验收角色',personality:'合成角色',background:'用于后台布局验收。'.repeat(50),avatarUrl:'/brand/'+ 'long-avatar-reference-'.repeat(12)+'.svg',publicationRequested:true,reviewStatus:'PENDING',copyrightStatement:'合成测试内容'}});
 await db.character.create({data:{creatorId:actors[0].id,name:'批量验收角色',personality:'合成角色',background:'合成背景',publicationRequested:true,reviewStatus:'PENDING',copyrightStatement:'合成测试内容'}});
}finally{await db.$disconnect();}
env.MODERATOR_USER_IDS=[actors[1].id,actors[3].id].join(',');env.PAYMENT_ADMIN_USER_IDS=[actors[2].id,actors[3].id].join(',');
let app,browser;const checks=[],errors=[];
try{
 app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','18799'],{env,stdio:'ignore',windowsHide:true});
 let ready=false;
 for(let i=0;i<100;i++){
  if(app.exitCode!==null)throw Error('owned app exited before readiness');
  try{if((await fetch(base+'/api/admin/access')).status===401){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 assert(ready,'owned app not ready');
 browser=await chromium.launch();
 const anon=await browser.newContext({viewport:{width:390,height:844}});const anonymous=await anon.newPage();
 await anonymous.goto(base+'/admin');await anonymous.getByText('请登录管理员账号。').waitFor();assert.equal(await anonymous.getByRole('link',{name:'内容审核'}).count(),0);await anon.close();checks.push('匿名后台显示登录入口');
 for(let i=0;i<actors.length;i++){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const response=await context.request.post(base+'/api/auth/login',{data:{email:actors[i].email,password}});assert.equal(response.status(),200);
  const {token}=await response.json();
  await context.addInitScript(t=>localStorage.setItem('khuiai_token',t),token);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const expected={moderation:i===1||i===3,finance:i===2||i===3,analytics:false,growth:false,operations:false,compliance:false};
  const access=await context.request.get(base+'/api/admin/access',{headers:{Authorization:`Bearer ${token}`}});assert.equal(access.status(),200);assert.deepEqual(await access.json(),expected);
  await page.goto(base+'/profile');
  await page.getByRole('link',{name:/我的角色与收藏/}).waitFor();
  if(i===0){assert.equal(await page.getByRole('link',{name:/管理后台/}).count(),0);await page.goto(base+'/admin');await page.getByText('当前账号没有管理权限，请联系站点运营人员。').waitFor();}
  else{
   await page.getByRole('link',{name:/管理后台/}).click();await page.waitForURL('**/admin');
   await page.getByRole('heading',{name:'管理后台'}).waitFor();
   const first=expected.moderation?'内容审核':'财务与充值';await page.getByRole('link',{name:new RegExp(first)}).waitFor();
   assert.equal(await page.getByRole('link',{name:/内容审核/}).count(),expected.moderation?1:0);
   assert.equal(await page.getByRole('link',{name:/财务与充值/}).count(),expected.finance?1:0);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:path.join(out,`admin-${i}.png`)});
   await page.getByRole('link',{name:new RegExp(first)}).click();await page.waitForURL(expected.moderation?'**/moderation':'**/finance');
   if(i===3){
    for(const width of [360,390,768,1280]){
     await page.setViewportSize({width,height:900});
     for(const route of ['/admin','/finance','/moderation']){
      await page.goto(base+route);await page.waitForLoadState('networkidle');
      if(route==='/admin')await page.getByRole('link',{name:/财务与充值/}).waitFor();
      if(route==='/finance')await page.getByRole('heading',{name:'充值套餐与赠送活动'}).waitFor();
      if(route==='/moderation')await page.getByRole('heading',{name:'布局验收角色'}).waitFor();
      const region=page.getByRole('region',{name:'后台工作区'});
      const size=await region.evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth}));assert(size.scroll<=size.client+1,`${route} content overflow at ${width}`);
      assert.equal(await page.getByRole('navigation',{name:'主导航'}).count(),0,'public navigation must not surround admin pages');
      const nav=page.getByRole('navigation',{name:width>=1024?'后台导航':'后台手机导航'});assert(await nav.isVisible());
      for(const box of await nav.locator('a').evaluateAll(items=>items.map(e=>e.getBoundingClientRect().toJSON())))assert(box.height>=44&&box.width>=44);
      await page.screenshot({path:path.join(out,`${route.slice(1)}-${width}.png`)});
     }
    }
    checks.push('后台三页四种宽度、独立导航及长内容无工作区溢出');
    page.on('dialog',dialog=>void dialog.accept());
    await page.goto(base+'/moderation');await page.getByRole('heading',{name:'布局验收角色',exact:true}).waitFor();
    for(const name of ['布局验收角色','批量验收角色'])await page.getByLabel('选择角色 '+name,{exact:true}).check();
    let batchResponse=page.waitForResponse(r=>r.url().endsWith('/api/moderation/characters/batch')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'批量通过公开',exact:true}).click();assert.equal((await batchResponse).status(),200);
    let publicRows=await (await context.request.get(base+'/api/characters')).json();assert.equal(publicRows.filter(r=>['布局验收角色','批量验收角色'].includes(r.name)).length,2);
    await page.waitForFunction(()=>{const boxes=[...document.querySelectorAll('input[type=checkbox]')];return boxes.length===2&&boxes.every(box=>!box.checked);});
    for(const name of ['布局验收角色','批量验收角色'])await page.getByLabel('选择角色 '+name,{exact:true}).check();
    await page.getByLabel('批量审核说明',{exact:true}).fill('合成批量下架验证');
    batchResponse=page.waitForResponse(r=>r.url().endsWith('/api/moderation/characters/batch')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'批量退回 / 下架',exact:true}).click();assert.equal((await batchResponse).status(),200);
    await page.getByText('暂无待处理角色。',{exact:true}).waitFor();
    publicRows=await (await context.request.get(base+'/api/characters')).json();assert.equal(publicRows.filter(r=>['布局验收角色','批量验收角色'].includes(r.name)).length,0);
    checks.push('批量角色审核页面通过/下架及前台公开列表同步');
   }
  }
  checks.push(`实际账号权限和后台导航 ${i}`);await context.close();
 }
 assert.deepEqual(errors,[]);
 await writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,checks,errors,isolatedDatabase:true,realAi:false,realPayment:false},null,2));
 console.log(JSON.stringify({passed:true,checks:checks.length}));
}finally{
 await browser?.close();
 if(app&&app.exitCode===null){if(process.platform==='win32')spawnSync('taskkill',['/pid',String(app.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});else app.kill('SIGTERM');await new Promise(resolve=>{if(app.exitCode!==null)resolve();else app.once('exit',resolve);});}
 for(const suffix of ['','-wal','-shm','-journal'])await rm(dbPath+suffix,{force:true});
}
