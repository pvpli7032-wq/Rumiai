import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const manifestPath=process.env.FRONTEND_REDESIGN_FIXTURE_MANIFEST;
assert.ok(manifestPath,'FRONTEND_REDESIGN_FIXTURE_MANIFEST is required; run under the isolated frontend fixture parent');
const fixture=JSON.parse(await readFile(manifestPath,'utf8'));
assert.equal(fixture.synthetic,true);
assert.ok(fixture.login?.email && fixture.login?.password && fixture.ids?.characterId && fixture.ids?.sceneCharacterId,'synthetic login and route IDs are required');
const base=process.env.FRONTEND_REDESIGN_BASE_URL || fixture.webBaseUrl;
const out=process.env.FRONTEND_REDESIGN_OUTPUT_DIR || '/tmp/rumiai-mobile-navigation';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/lib64/chromium-browser/headless_shell',args:['--no-sandbox']});
const results=[],errors=[];
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await context.newPage();page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
const nav=()=>page.getByRole('navigation',{name:'主导航'});
async function route(path){await page.goto(base+path,{waitUntil:'networkidle'});await page.waitForFunction(()=>!!history.state?.xingbanNavigation);}
async function url(path){await page.waitForURL(u=>u.pathname+u.search===path);await page.waitForTimeout(250);}
async function back(){await page.getByRole('button',{name:'返回上一页',exact:true}).first().click();}
async function check(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});console.log(name,e.message);await page.screenshot({path:out+'/'+results.length+'-failed.png'});}}
try{
await route('/login');await page.locator('input[type=email]').fill(fixture.login.email);await page.locator('input[type=password]').fill(fixture.login.password);await page.locator('form').getByRole('button',{name:/登录/}).click();await page.waitForURL(u=>u.pathname!=='/login');
await check('owned secondary back returns to tab without duplicate loop',async()=>{
 await route('/discover');await nav().getByRole('link',{name:'我的',exact:true}).click();await url('/profile');
 await page.locator('a[href="/shop"]:visible').first().click();await url('/shop');await back();await url('/profile');await page.goBack();await url('/discover');
});
await check('history preserves Next state and coalesces same URL',async()=>{
 await route('/discover');const state=await page.evaluate(()=>{const before=history.length;history.replaceState({...history.state,customNavigationProbe:17},'');history.pushState({...history.state},'',location.href);return {before,after:history.length,state:history.state};});
 assert.equal(state.before,state.after);assert.equal(state.state.customNavigationProbe,17);assert.equal(state.state.__NA,true);assert.ok(state.state.__PRIVATE_NEXTJS_INTERNALS_TREE);
});
await check('direct entry back stays in app',async()=>{await page.goto('about:blank');await route('/shop/ledger');await back();await url('/shop');assert.equal(new URL(page.url()).origin,new URL(base).origin);});
await check('discover scroll survives tab roundtrip',async()=>{
 await route('/discover');await page.locator('.app-content').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=350;});await page.waitForTimeout(300);
 const before=await page.locator('.app-content').evaluate(el=>el.scrollTop);assert.ok(before>100,'fixture must have scrollable discover');
 await nav().getByRole('link',{name:'广场',exact:true}).click();await url('/square');await nav().getByRole('link',{name:'发现',exact:true}).click();await url('/discover');
 await page.waitForFunction(v=>Math.abs(document.querySelector('.app-content').scrollTop-v)<5,before);
});
await check('changing recommendation batch preserves scroll and Next history',async()=>{
 await route('/discover');const button=page.getByRole('button',{name:'换一批',exact:true});await button.scrollIntoViewIfNeeded();
 await page.locator('.app-content').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=150;});await page.waitForTimeout(100);
 const before=await page.locator('.app-content').evaluate(el=>el.scrollTop);assert.ok(before>100);
 await button.click();await page.waitForURL(u=>u.searchParams.get('batch')==='1');await page.waitForTimeout(250);
 assert.ok(Math.abs(await page.locator('.app-content').evaluate(el=>el.scrollTop)-before)<5);
 const state=await page.evaluate(()=>history.state);assert.equal(state.__NA,true);assert.ok(state.__PRIVATE_NEXTJS_INTERNALS_TREE);assert.ok(state.xingbanNavigation);
});
await check('anonymous character retains exact detail and list state through auth',async()=>{
 await context.clearCookies();await page.evaluate(()=>localStorage.clear());
 const response=await page.request.get(base+'/api/characters?sort=popular');const data=await response.json();const rows=Array.isArray(data)?data:data.data;
 const character=rows.find(c=>c.tags?.split(',').filter(Boolean).length);assert.ok(character,'public fixture must include tagged character');
 const filter=new URLSearchParams({view:'characters',q:character.name,type:character.tags.split(',')[0],batch:'2'});
 const listPath='/discover?'+filter;
 await route(listPath);await page.reload({waitUntil:'networkidle'});assert.equal(await page.getByRole('searchbox',{name:'搜索角色'}).inputValue(),character.name);
 const card=page.locator('button[aria-haspopup="dialog"]').first();await card.scrollIntoViewIfNeeded();await card.click();
 await page.waitForURL(u=>u.searchParams.has('character'));const detailURL=page.url();
 const listScroll=await page.locator('.app-content').evaluate(el=>el.scrollTop);
 await page.getByRole('dialog').getByRole('button',{name:/开始聊天|进入场景/}).click();await page.waitForURL(u=>u.pathname==='/login');
 const next=new URL(page.url()).searchParams.get('next');assert.ok(next?.startsWith('/chat?character='),next);
 await page.locator('a[href^="/register"]').click();await page.waitForURL(u=>u.pathname==='/register');assert.equal(new URL(page.url()).searchParams.get('next'),next);
 await page.locator('a[href^="/login?next="]').click();await page.waitForURL(u=>u.pathname==='/login');assert.equal(new URL(page.url()).searchParams.get('next'),next);
 await page.locator('input[type=email]').fill(fixture.login.email);await page.locator('input[type=password]').fill(fixture.login.password);await page.locator('form').getByRole('button',{name:/登录/}).click();await page.waitForURL(u=>u.pathname==='/chat');
 assert.equal(new URL(page.url()).searchParams.get('character'),new URL(next,base).searchParams.get('character'));
 await page.waitForTimeout(500);await back();await page.waitForURL(detailURL);await page.getByRole('dialog').waitFor();
 await page.getByRole('button',{name:'返回角色列表',exact:true}).click();await url(listPath);await page.getByRole('dialog').waitFor({state:'detached'});
 await page.waitForFunction(v=>Math.abs(document.querySelector('.app-content').scrollTop-v)<5,listScroll);
});
}finally{await writeFile(out+'/results.json',JSON.stringify({results,pageErrors:errors},null,2));await browser.close();console.log(JSON.stringify({results,pageErrors:errors}));}
if(results.some(r=>!r.pass)||errors.length)process.exitCode=1;
