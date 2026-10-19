import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir,open,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {chromium} from 'playwright';
import {createIsolatedDatabase} from './helpers/create-isolated-db.mjs';

const stamp=`${process.pid}-${Date.now()}`,file=`ai-provider-browser-${stamp}.db`,base='http://127.0.0.1:18804',out=path.resolve('artifacts/ai-provider-browser',stamp);await mkdir(out,{recursive:true});
const env={...process.env,NODE_ENV:'production',DATABASE_URL:`file:./${file}`,JWT_SECRET:randomBytes(48).toString('hex'),AI_PROVIDER_ENCRYPTION_KEY:randomBytes(32).toString('hex'),OPENAI_API_KEY:'',EZFP_ENABLED:'false',EZFP_REFUNDS_ENABLED:'false',DISABLE_MOCK_AI:'true',ALLOW_SIMULATED_PURCHASES:'false',MODERATOR_USER_IDS:'',PAYMENT_ADMIN_USER_IDS:'',NEXT_DIST_DIR:'.next-build',NEXT_PUBLIC_SITE_URL:base};delete env.RUST_LOG;Object.assign(process.env,env);
const dbPath=path.resolve('prisma',file)
await createIsolatedDatabase(dbPath);
const {db,pragmasReady}=await import('../src/lib/db.ts');await pragmasReady;const {bootstrapOwner,saveOperator,saveRole}=await import('../src/lib/admin/management-service.ts');
const password=randomBytes(24).toString('hex'),users=[],checks=[],errors=[];let app,browser;
try{
  for(const username of ['owner','ai-manager','ai-reader'])users.push(await db.user.create({data:{username:`${username.replaceAll('-','_')}_${stamp}`,email:`${username}-${stamp}@example.invalid`,passwordHash:await bcrypt.hash(password,10)}}));
  const [owner,manager,reader]=users;await bootstrapOwner(owner.email);const providerRole=await db.adminRole.findUniqueOrThrow({where:{code:'AI_PROVIDER_MANAGER'}});const readRole=await saveRole(owner.id,{name:`AI只读_${stamp}`,permissions:['ai.providers.read'],reason:'浏览器隔离测试'});
  await saveOperator(owner.id,{userId:manager.id,enabled:true,version:0,roleIds:[providerRole.id],reason:'AI管理权限'});await saveOperator(owner.id,{userId:reader.id,enabled:true,version:0,roleIds:[readRole.id],reason:'AI只读权限'});
  app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','18804'],{env,stdio:'ignore',windowsHide:true});
  let ready=false;for(let i=0;i<150;i++){if(app.exitCode!==null)throw Error('owned server exited');try{if((await fetch(base+'/api/admin/ai/providers')).status===401){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready,'isolated production server did not become ready');
  browser=await chromium.launch();async function login(user){const context=await browser.newContext({viewport:{width:1280,height:900}}),response=await context.request.post(base+'/api/auth/login',{data:{email:user.email,password}});assert.equal(response.status(),200);const {token}=await response.json();await context.addInitScript(value=>localStorage.setItem('xingban_token',value),token);const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));return{context,page,token};}
  const cms=await login(manager);await cms.page.goto(base+'/admin/ai/providers');await cms.page.getByRole('heading',{name:'AI 供应商',exact:true}).waitFor();await cms.page.getByRole('button',{name:'新增供应商',exact:true}).click();const apiKey=`browser-fixture-${randomBytes(20).toString('hex')}`;
  await cms.page.getByLabel('供应商名称',{exact:true}).fill('隔离浏览器供应商');await cms.page.getByLabel('API 基础地址',{exact:true}).fill('https://api.example.invalid/v1');await cms.page.getByLabel('API 密钥',{exact:true}).fill(apiKey);await cms.page.getByLabel('启用此供应商',{exact:true}).check();await cms.page.getByLabel('操作理由',{exact:true}).fill('保存浏览器隔离连接');await cms.page.getByRole('button',{name:'保存供应商',exact:true}).click();await cms.page.getByText('供应商配置已保存。',{exact:true}).waitFor();await cms.page.getByText('密钥已配置',{exact:false}).waitFor();
  const response=await cms.context.request.get(base+'/api/admin/ai/providers',{headers:{Authorization:`Bearer ${cms.token}`}}),providers=await response.json();assert.equal(response.status(),200);assert.equal(providers.length,1);assert.equal(providers[0].hasSecret,true);assert.equal(JSON.stringify(providers).includes(apiKey),false);assert.equal((await db.aiProvider.findUniqueOrThrow({where:{id:providers[0].id}})).secretCiphertext.includes(apiKey),false);checks.push('供应商在生产后台保存；密钥仅加密储存且读取接口不回显');
  const readerView=await login(reader);await readerView.page.goto(base+'/admin/ai/providers');await readerView.page.getByRole('heading',{name:'AI 供应商',exact:true}).waitFor();assert.equal(await readerView.page.getByRole('button',{name:'新增供应商',exact:true}).count(),0);const denied=await readerView.context.request.post(base+'/api/admin/ai/providers',{headers:{Authorization:`Bearer ${readerView.token}`},data:{name:'越权',baseUrl:'https://api.example.invalid/v1',isActive:false,sortOrder:2,reason:'权限测试'}});assert.equal(denied.status(),403);checks.push('只读角色可以查看状态，但不能新增或修改连接');
  await cms.page.setViewportSize({width:390,height:844});await cms.page.reload();await cms.page.getByRole('heading',{name:'AI 供应商',exact:true}).waitFor();assert(await cms.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await cms.page.screenshot({path:path.join(out,'ai-provider-mobile.png')});assert.deepEqual(errors,[]);checks.push('AI 供应商页面390px无横向溢出，页面错误0');
  await writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,checks,database:file,secretReturned:false,realProviderCalled:false},null,2));
}finally{if(browser)await browser.close();if(app&&app.exitCode===null){app.kill();await new Promise(resolve=>app.once('exit',resolve));}await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])await rm(path.resolve('prisma',file+suffix),{force:true});}
