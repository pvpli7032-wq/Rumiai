// Authenticated, read-only regression: never submit a saved setting or role.
// ADMIN_ORIGIN=https://... ADMIN_SESSION_TOKEN=... node tests/e2e/admin-settings-navigation.mjs
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const origin=process.env.ADMIN_ORIGIN;
const token=process.env.ADMIN_SESSION_TOKEN;
assert.ok(origin&&token,'Provide ADMIN_ORIGIN and a temporary ADMIN_SESSION_TOKEN; no credentials are stored by this script.');
const url=new URL(origin);
assert.equal(url.pathname,'/','ADMIN_ORIGIN must be an origin without a path');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const writes=[],errors=[];
await context.addCookies([{name:'xingban_admin_session',value:token,domain:url.hostname,path:'/',httpOnly:true,secure:url.protocol==='https:',sameSite:'Strict'}]);
await context.route('**/api/**',route=>{
  if(!['GET','HEAD','OPTIONS'].includes(route.request().method())){writes.push(route.request().method()+' '+new URL(route.request().url()).pathname);return route.abort();}
  return route.continue();
});
const page=await context.newPage();page.setDefaultTimeout(15000);
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto(new URL('/admin/settings',url).href,{waitUntil:'networkidle'});
  const search=page.getByRole('textbox',{name:'搜索全部设置',exact:true});
  const firstInput=page.locator('[data-setting-key="chat.maxMessageChars"] input');
  const saved=await firstInput.inputValue(),draft=Number(saved)===19999?'19998':'19999';
  await firstInput.fill(draft);
  await search.fill('content.post.maxChars');await page.getByRole('option').first().click();
  await search.fill('chat.maxMessageChars');await page.getByRole('option').first().click();
  assert.equal(await firstInput.inputValue(),draft,'same-category navigation lost the draft');
  await search.fill('billing.chargingEnabled');page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('option').first().click();
  assert.equal(await firstInput.inputValue(),draft,'cancelled category navigation lost the draft');
  await search.fill('');await page.getByRole('button',{name:'放弃修改',exact:true}).click();
  assert.equal(await firstInput.inputValue(),saved);
  for(const key of ['billing.chargingEnabled','limits.chat.windowSeconds']){
    await search.fill(key);await page.getByRole('option').first().click();
    await page.waitForFunction(key=>{
      const field=document.querySelector(`[data-setting-key="${CSS.escape(key)}"]`);
      return Boolean(field?.contains(document.activeElement));
    },key);
  }
  await page.goto(new URL('/admin/operators',url).href,{waitUntil:'networkidle'});
  const permissions=page.getByRole('textbox',{name:'搜索业务权限',exact:true});
  await permissions.fill('ai.models.read');
  const checkbox=page.locator('fieldset').filter({has:permissions}).getByRole('checkbox').first();
  const initial=await checkbox.isChecked();await checkbox.setChecked(!initial);
  await permissions.fill('growth');await permissions.fill('ai.models.read');assert.equal(await checkbox.isChecked(),!initial);
  await checkbox.setChecked(initial);
  assert.deepEqual(writes,[],'Regression test attempted a persistent API write');
  assert.deepEqual(errors,[]);
  console.log('PASS: same-group draft retention, cancelled cross-group navigation, loaded-control focus, advanced-field focus, permission search selection; no persistent writes.');
}finally{await browser.close();}
