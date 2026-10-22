import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, open, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {PrismaClient} from '@prisma/client';

const stamp=`${process.pid}-${Date.now()}`;
const file=`state-runtime-${stamp}.db`;
const uploadRoot=path.resolve('artifacts','state-recovery-runtime',stamp);
const sourceUploads=path.join(uploadRoot,'source-uploads');
const backup=path.join(uploadRoot,'backup');
const recovered=path.join(uploadRoot,'recovered');
const sourceDb=path.resolve('prisma',file);
// 与 npm run verify:build 的产出目录保持一致，直接跑不必再手动指定 NEXT_DIST_DIR。
const dist=process.env.NEXT_DIST_DIR||'.next-validation-build';
const previousRelease=process.env.RECOVERY_PREVIOUS_RELEASE;
const env={...process.env,NODE_ENV:'production',DATABASE_URL:`file:./${file}`,UPLOADS_DIRECTORY:sourceUploads,JWT_SECRET:randomUUID()+randomUUID(),NEXT_PUBLIC_SITE_URL:'http://127.0.0.1'};
env.AI_PROVIDER_ENCRYPTION_KEY=randomBytes(32).toString('hex');
env.PAYMENT_MERCHANT_ENCRYPTION_KEY=randomBytes(32).toString('hex');
delete env.RUST_LOG;
const empty=await open(sourceDb,'wx');await empty.close();
await mkdir(sourceUploads,{recursive:true});
const migrated=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{cwd:process.cwd(),env,encoding:'utf8',windowsHide:true});
assert.equal(migrated.status,0,migrated.stdout+migrated.stderr);
Object.assign(process.env,env);
const {db,pragmasReady}=await import('../src/lib/db.ts');await pragmasReady;
const {bootstrapOwner}=await import('../src/lib/admin/management-service.ts');
const {changeSiteContent}=await import('../src/lib/site-content/management-service.ts');
const {saveAccountUpload}=await import('../src/lib/uploads/storage-service.ts');
const {createStateBackup,restoreStateBackup}=await import('../src/lib/operations/state-backup.mjs');
const {encryptProviderSecret,decryptProviderSecret}=await import('../src/lib/ai/providers/secret.ts');
const {encryptMerchantValue,decryptMerchantValue}=await import('../src/lib/payments/merchant-secrets.ts');
const password=randomUUID()+randomUUID();
let app,port;

async function unusedPort(){const server=createServer();await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));const address=server.address();await new Promise(resolve=>server.close(resolve));return address.port;}

test('restored database and uploads start the app, preserve auth and accept new writes without replacing source state',async t=>{
  assert(existsSync(path.resolve(dist,'BUILD_ID')),`先生成生产构建目录 ${dist}`);
  const owner=await db.user.create({data:{username:`recovery_${stamp.replaceAll('-','_')}`,email:`recovery-${stamp}@example.invalid`,passwordHash:await bcrypt.hash(password,4)}});
  await bootstrapOwner(owner.email);
  const providerSecret=randomBytes(32).toString('hex');
  const provider=await db.aiProvider.create({data:{name:`recovery-${stamp}`,baseUrl:'https://recovery.example.invalid/v1',isActive:false,...encryptProviderSecret(providerSecret)}});
  const keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  const privateKey=encryptMerchantValue(keys.privateKey),platformKey=encryptMerchantValue(keys.publicKey);
  const merchant=await db.paymentMerchant.create({data:{name:`recovery-${stamp}`,isActive:false}});
  const revision=await db.paymentMerchantRevision.create({data:{merchantId:merchant.id,revision:1,merchantNo:'local-recovery-only',apiBaseUrl:'https://recovery.example.invalid',createdBy:owner.id,privateKeyCiphertext:privateKey.ciphertext,privateKeyNonce:privateKey.nonce,privateKeyTag:privateKey.tag,platformKeyCiphertext:platformKey.ciphertext,platformKeyNonce:platformKey.nonce,platformKeyTag:platformKey.tag}});
  const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  const image=await saveAccountUpload(owner.id,new File([pixel],'recovery-image.png',{type:'image/png'}));
  await db.uploadAsset.update({where:{url:image.url},data:{siteOwned:true}});
  const pageSlug=`recovery-${stamp.toLowerCase().replaceAll(/[^a-z0-9-]/g,'-')}`;
  const page=await changeSiteContent(owner.id,'PAGE',null,{action:'PUBLISH',reason:'恢复运行验收',content:{slug:pageSlug,kind:'PAGE',title:'恢复验收页面',summary:'数据库与上传联合恢复',blocks:[{type:'IMAGE',src:image.url,alt:'恢复素材',caption:'恢复页面可见'}],sortOrder:1,isActive:true,startsAt:null,endsAt:null}});
  const sourceDraftCount=await db.siteContentDraft.count({where:{contentType:'PAGE',contentId:page.id}});
  const snapshot=await createStateBackup(sourceDb,sourceUploads,backup);
  assert.equal(snapshot.integrity,'ok');assert.equal(snapshot.manifest.referenceCount,1);assert.equal(snapshot.manifest.uploads.length,1);
  const restored=await restoreStateBackup(backup,recovered);
  assert.equal(restored.integrity,'ok');assert.equal(restored.foreignKeys,'ok');
  port=await unusedPort();
  const runtimeEnv={...env,NODE_ENV:'production',DATABASE_URL:`file:${path.join(recovered,'database.db').split(path.sep).join('/')}`,UPLOADS_DIRECTORY:path.join(recovered,'uploads'),OPENAI_API_KEY:'',EZFP_ENABLED:'false',EZFP_REFUNDS_ENABLED:'false',DISABLE_MOCK_AI:'true',ALLOW_SIMULATED_PURCHASES:'false',AI_MODEL:'',NEXT_DIST_DIR:dist,NEXT_PUBLIC_SITE_URL:`http://127.0.0.1:${port}`};
  app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:process.cwd(),env:runtimeEnv,stdio:'ignore',windowsHide:true});
  t.after(async()=>{if(app&&app.exitCode===null){app.kill();await new Promise(resolve=>app.once('exit',resolve));}});
  const base=runtimeEnv.NEXT_PUBLIC_SITE_URL;let ready=false,lastError='no response';
  for(let i=0;i<180;i++){
    if(app.exitCode!==null)throw Error(`恢复实例提前退出，code=${app.exitCode}`);
    try{const response=await fetch(`${base}/api/admin/site-content`);if(response.status===401){ready=true;break;}lastError=`unexpected HTTP ${response.status}`;}catch(error){lastError=String(error);}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert(ready,`恢复实例未就绪：${lastError}`);
  const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:owner.email,password})});const loginBody=await login.json();assert.equal(login.status,200,JSON.stringify(loginBody));const {token}=loginBody;
  const backupRecords=await fetch(`${base}/api/admin/operations/backups`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(backupRecords.status,200);const recoveryRecord=(await backupRecords.json()).activeRestore;assert.equal(recoveryRecord.kind,'STATE_RESTORE');assert.equal(recoveryRecord.verification,'RECORDED_AT_OPERATION');assert.equal(recoveryRecord.recordedAt,restored.restoration.completedAt);
  const pages=await fetch(`${base}/pages/${pageSlug}`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(pages.status,200);assert((await pages.text()).includes('恢复验收页面'));
  const restoredImage=await fetch(`${base}${image.url}`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(restoredImage.status,200);assert.deepEqual(Buffer.from(await restoredImage.arrayBuffer()),pixel);
  const adminRead=await fetch(`${base}/api/admin/site-content`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(adminRead.status,200);const managed=await adminRead.json();const row=managed.PAGE.items.find(item=>item.id===page.id);assert(row);
  const newWrite=await fetch(`${base}/api/admin/site-content/PAGE/${page.id}`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'SAVE',content:{...row.content,title:'恢复实例新写入'},version:row.version,reason:'恢复后新写入验收'})});assert.equal(newWrite.status,200,await newWrite.text());
  const afterWrite=await fetch(`${base}/api/admin/operations/backups`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(afterWrite.status,200);assert.equal((await afterWrite.json()).activeRestore.verification,'RECORDED_AT_OPERATION');
  // Restart the restored instance with rotated session signing material. Keep
  // its database and uploads together so post-recovery writes are not discarded.
  app.kill();await new Promise(resolve=>app.once('exit',resolve));
  let expectedDraftTitle='恢复实例新写入';
  if(previousRelease){
    assert(path.isAbsolute(previousRelease),'旧发布目录必须为绝对路径');
    const previousDist=path.join(previousRelease,dist);
    assert.notEqual((await readFile(path.join(previousDist,'BUILD_ID'),'utf8')).trim(),(await readFile(path.join(dist,'BUILD_ID'),'utf8')).trim(),'跨版本验收必须使用不同构建');
    app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:previousRelease,env:runtimeEnv,stdio:'ignore',windowsHide:true});
    ready=false;
    for(let i=0;i<180;i++){
      if(app.exitCode!==null)throw Error(`旧版本恢复实例启动失败，code=${app.exitCode}`);
      try{if((await fetch(`${base}/api/admin/site-content`)).status===401){ready=true;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert(ready,'旧版本恢复实例未就绪');
    const previousLogin=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:owner.email,password})});
    assert.equal(previousLogin.status,200);const previousToken=(await previousLogin.json()).token;
    const previousRead=await fetch(`${base}/api/admin/site-content`,{headers:{Authorization:`Bearer ${previousToken}`}});assert.equal(previousRead.status,200);
    const previousRow=(await previousRead.json()).PAGE.items.find(item=>item.id===page.id);assert(previousRow);
    const previousImage=await fetch(`${base}${image.url}`,{headers:{Authorization:`Bearer ${previousToken}`}});assert.equal(previousImage.status,200);assert.deepEqual(Buffer.from(await previousImage.arrayBuffer()),pixel);
    expectedDraftTitle='旧版本回滚新写入';
    const previousWrite=await fetch(`${base}/api/admin/site-content/PAGE/${page.id}`,{method:'PATCH',headers:{Authorization:`Bearer ${previousToken}`,'Content-Type':'application/json'},body:JSON.stringify({action:'SAVE',content:{...previousRow.content,title:expectedDraftTitle},version:previousRow.version,reason:'隔离跨版本回滚写入验收'})});assert.equal(previousWrite.status,200,await previousWrite.text());
    app.kill();await new Promise(resolve=>app.once('exit',resolve));
    t.diagnostic('不同BUILD_ID的旧应用已读取恢复库与上传、登录并写入；随后切回当前应用，保留同一恢复状态');
  }
  app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:process.cwd(),env:{...runtimeEnv,JWT_SECRET:randomUUID()+randomUUID()},stdio:'ignore',windowsHide:true});
  ready=false;
  for(let i=0;i<180;i++){
    if(app.exitCode!==null)throw Error(`恢复实例重启失败，code=${app.exitCode}`);
    try{if((await fetch(`${base}/api/admin/site-content`)).status===401){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert(ready,'恢复实例重启后未就绪');
  assert.equal((await fetch(`${base}/api/admin/site-content`,{headers:{Authorization:`Bearer ${token}`}})).status,401,'轮换JWT密钥后旧令牌必须失效');
  const relogin=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:owner.email,password})});
  assert.equal(relogin.status,200);const freshToken=(await relogin.json()).token;
  const restartedRead=await fetch(`${base}/api/admin/site-content`,{headers:{Authorization:`Bearer ${freshToken}`}});
  assert.equal(restartedRead.status,200);
  const restartedRow=(await restartedRead.json()).PAGE.items.find(item=>item.id===page.id);
  assert(restartedRow,'恢复实例重启后原页面必须保留');
  const restartedImage=await fetch(`${base}${image.url}`,{headers:{Authorization:`Bearer ${freshToken}`}});
  assert.equal(restartedImage.status,200);assert.deepEqual(Buffer.from(await restartedImage.arrayBuffer()),pixel);
  const recoveryClient=new PrismaClient({datasources:{db:{url:`file:${path.join(recovered,'database.db').split(path.sep).join('/')}`}},log:[]});
  try{
    const recoveredProvider=await recoveryClient.aiProvider.findUniqueOrThrow({where:{id:provider.id}});
    const recoveredRevision=await recoveryClient.paymentMerchantRevision.findUniqueOrThrow({where:{id:revision.id}});
    const recoveredPrivate={ciphertext:recoveredRevision.privateKeyCiphertext,nonce:recoveredRevision.privateKeyNonce,tag:recoveredRevision.privateKeyTag};
    const recoveredPlatform={ciphertext:recoveredRevision.platformKeyCiphertext,nonce:recoveredRevision.platformKeyNonce,tag:recoveredRevision.platformKeyTag};
    assert.equal(decryptProviderSecret(recoveredProvider)===providerSecret,true,'供应商测试凭据恢复后应可解密');
    assert.equal(decryptMerchantValue(recoveredPrivate)===keys.privateKey,true,'商户测试私钥恢复后应可解密');
    assert.equal(decryptMerchantValue(recoveredPlatform)===keys.publicKey,true,'平台测试公钥恢复后应可解密');
    try{
      process.env.AI_PROVIDER_ENCRYPTION_KEY=randomBytes(32).toString('hex');
      process.env.PAYMENT_MERCHANT_ENCRYPTION_KEY=randomBytes(32).toString('hex');
      assert.throws(()=>decryptProviderSecret(recoveredProvider));
      assert.throws(()=>decryptMerchantValue(recoveredPrivate));
      assert.throws(()=>decryptMerchantValue(recoveredPlatform));
    }finally{
      process.env.AI_PROVIDER_ENCRYPTION_KEY=env.AI_PROVIDER_ENCRYPTION_KEY;
      process.env.PAYMENT_MERCHANT_ENCRYPTION_KEY=env.PAYMENT_MERCHANT_ENCRYPTION_KEY;
    }
    assert.equal(decryptProviderSecret(recoveredProvider)===providerSecret,true);
    assert.equal(decryptMerchantValue(recoveredPrivate)===keys.privateKey,true);
    const draft=await recoveryClient.siteContentDraft.findUniqueOrThrow({where:{contentType_contentId:{contentType:'PAGE',contentId:page.id}}});assert(JSON.parse(draft.draftJson).title===expectedDraftTitle);assert.equal((await recoveryClient.sitePage.findUniqueOrThrow({where:{id:page.id}})).title,'恢复验收页面');
  }finally{await recoveryClient.$disconnect();}
  const sourcePage=await db.sitePage.findUniqueOrThrow({where:{id:page.id}});assert.equal(sourcePage.title,'恢复验收页面');assert.equal(await db.siteContentDraft.count({where:{contentType:'PAGE',contentId:page.id}}),sourceDraftCount);
});

test.after(async()=>{
  if(app&&app.exitCode===null){app.kill();await new Promise(resolve=>app.once('exit',resolve));}
  await db.$disconnect();
  for(const suffix of ['','-wal','-shm','-journal'])await rm(path.resolve('prisma',file+suffix),{force:true});
  if(uploadRoot.startsWith(path.resolve('artifacts','state-recovery-runtime')+path.sep))await rm(uploadRoot,{recursive:true,force:true});
});
