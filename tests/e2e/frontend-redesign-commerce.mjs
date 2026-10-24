import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const baseURL=process.env.FRONTEND_REDESIGN_BASE_URL??'http://127.0.0.1:3310';
const manifestPath=process.env.FRONTEND_REDESIGN_FIXTURE_MANIFEST;
const outputDir=process.env.FRONTEND_REDESIGN_OUTPUT_DIR??'/tmp/khui-m4-commerce-qa';
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??'/usr/lib64/chromium-browser/headless_shell';
assert.ok(manifestPath,'FRONTEND_REDESIGN_FIXTURE_MANIFEST is required');
const fixture=JSON.parse(await readFile(manifestPath,'utf8'));
assert.ok(fixture.login?.email&&fixture.login?.password,'fixture login is required');
await mkdir(outputDir,{recursive:true});
const report={baseURL,checks:[],notApplicable:[]};
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try { const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1}); const page=await context.newPage();
  await page.goto(`${baseURL}/login`,{waitUntil:'networkidle'});await page.locator('input[type=email]').fill(fixture.login.email);await page.locator('input[type=password]').first().fill(fixture.login.password);await page.locator('form').getByRole('button',{name:/登录/}).click();await page.waitForURL(url=>!url.pathname.endsWith('/login'));
  await page.goto(`${baseURL}/creator`,{waitUntil:'networkidle'});assert.ok((await page.locator('body').innerText()).includes('创作工作区')||(await page.locator('body').innerText()).includes('把你的想象'),'creator dashboard must render');report.checks.push('creator dashboard');
  await page.goto(`${baseURL}/creator?new=1`,{waitUntil:'networkidle'});assert.equal(await page.getByText('请填写角色名称').count(),0);await page.getByRole('button',{name:'下一步'}).first().click();assert.ok(await page.getByText('请填写角色名称').count()>0,'identity step validation');report.checks.push('creator required validation');
  const owned=fixture.ids?.ownedCharacterId; if(owned){await page.goto(`${baseURL}/creator?edit=${encodeURIComponent(owned)}`,{waitUntil:'networkidle'});await page.getByRole('button',{name:'预览'}).click();const previewDialog=page.getByRole('dialog',{name:'角色预览'});assert.ok(await previewDialog.count()>0,'edit preview opens');const closePreview=previewDialog.getByRole('button',{name:'关闭',exact:true}).filter({hasText:/^关闭$/});assert.equal(await closePreview.count(),1,'preview has one text close button');assert.ok(await closePreview.isVisible(),'preview text close button must be visible');await closePreview.click();await previewDialog.waitFor({state:'hidden'});report.checks.push('creator edit preview');
    // English API errors are intentionally mapped by zhError; use a Chinese marker and await the actual async upload lifecycle.
    const uploadError='M4 隔离图片上传失败';
    await page.route('**/api/upload',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:uploadError})}));
    const uploadResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/upload'&&response.request().method()==='POST');
    const input=page.locator('input[type=file]');await input.setInputFiles(path.join(process.cwd(),'apps','web','public','brand','icon-512.png'));
    assert.equal((await uploadResponse).status(),500,'the upload fault must be injected');
    const uploadErrorMessage=page.getByText(uploadError,{exact:true});await uploadErrorMessage.waitFor({state:'visible'});assert.ok(await uploadErrorMessage.isVisible(),'injected upload failure must be visible');
    const nextStep=page.getByRole('button',{name:'下一步'}).first();await nextStep.click({trial:true});assert.equal(await nextStep.isDisabled(),false,'upload failure must release identity-step busy');await page.unroute('**/api/upload');report.checks.push('upload failure releases busy');}else throw Error('fixture ids.ownedCharacterId is required');
  await page.goto(`${baseURL}/my-characters`,{waitUntil:'networkidle'});const withdraw=page.getByRole('button',{name:/撤回/});if(await withdraw.count()){page.once('dialog',d=>d.dismiss());await withdraw.first().click();report.checks.push('withdraw confirmation cancel')}else report.notApplicable.push('no fixture publication to test withdrawal cancel');
  const user=fixture.ids?.creatorUsername;if(user){await page.goto(`${baseURL}/profile/${encodeURIComponent(user)}/connections`,{waitUntil:'networkidle'});assert.ok(await page.locator('main').count());report.checks.push('connections route')}else report.notApplicable.push('fixture creatorUsername absent');
  let membershipPosts=0,coinPosts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/memberships/checkout'))membershipPosts++;if(r.method()==='POST'&&r.url().includes('/api/coins/orders'))coinPosts++;});
  await page.goto(`${baseURL}/membership`,{waitUntil:'domcontentloaded'});await page.waitForTimeout(500);assert.ok((await page.locator('body').innerText()).includes('等待支付确认'),'synthetic pending membership order must be explicit');report.checks.push('membership pending semantics');const membershipBody=await page.locator('body').innerText();if(/暂未开放|支付渠道暂不可用/.test(membershipBody)){assert.equal(membershipPosts,0);report.checks.push('membership closed has no checkout POST')}else throw Error('fixture checkout policy must be closed; refusing to exercise real checkout');
  const refundPosts=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/me/membership/refund'))refundPosts.push(r.url());});const refundButton=page.getByRole('button',{name:/查看退款金额|重新申请退款|重试确认退款/}).first();assert.ok(await refundButton.count()>0,'synthetic paid order must expose refund preview');await refundButton.click();page.once('dialog',d=>d.dismiss());await page.waitForTimeout(100);assert.equal(refundPosts.length,0,'cancelling refund preview must not POST refund');report.checks.push('refund preview cancel has zero POST');
  await page.goto(`${baseURL}/shop`,{waitUntil:'networkidle'});const shopBody=await page.locator('body').innerText();if(/暂未开放|支付渠道暂不可用/.test(shopBody)){assert.equal(coinPosts,0);report.checks.push('shop closed has no order POST')}else throw Error('fixture checkout policy must be closed; refusing to exercise real checkout');
  await page.goto(`${baseURL}/shop/ledger`,{waitUntil:'networkidle'});assert.ok(await page.getByText('金币流水').count());report.checks.push('ledger route');
  await page.screenshot({path:path.join(outputDir,'m4-commerce-desktop.png'),fullPage:true});await context.close();
} finally {await browser.close();await writeFile(path.join(outputDir,'commerce-report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({status:'passed',...report}));