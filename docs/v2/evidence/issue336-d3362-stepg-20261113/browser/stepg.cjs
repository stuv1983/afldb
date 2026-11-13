const {chromium}=require('D:/dev/afldb/node_modules/@playwright/test');
const fs=require('fs'),path=require('path');
const ROOT='D:/dev/afldb/.local-stepg-20261113';
const BASE='https://beta.afldb.com';
const expected=JSON.parse(fs.readFileSync(path.join(ROOT,'expected.json')));
const OUT=path.join(ROOT,'browser');fs.mkdirSync(OUT,{recursive:true});
const checks=[];let browser;
const check=(name,ok,detail='')=>{checks.push({name,ok:!!ok,detail});console.log((ok?'PASS ':'FAIL ')+name+' '+detail);};
(async()=>{
 browser=await chromium.launch({headless:false});
 const ctx=await browser.newContext({viewport:{width:1280,height:800}});
 const signin=await ctx.newPage();await signin.goto(BASE+'/beta');
 console.log('READY: sign in in this browser through /beta or /admin/login. Waiting up to 30 minutes.');
 let authenticated=false;
 const until=Date.now()+30*60*1000;
 while(Date.now()<until){
 const r=await ctx.request.get(BASE+'/draft',{maxRedirects:0});
 if(r.status()===200){authenticated=true;break;}
 await new Promise(r=>setTimeout(r,3000));
 }
 if(!authenticated)throw Error('Sign-in timed out; session discarded');
 console.log('AUTHENTICATED');
 const state=await ctx.storageState();
 for(const vp of [{tag:'desktop',width:1280,height:800},{tag:'mobile',width:390,height:844,isMobile:true}]){
 const c=await browser.newContext({storageState:state,viewport:{width:vp.width,height:vp.height},isMobile:!!vp.isMobile});
 const page=await c.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const consoleErrors=[];page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
 for(const year of [2008,2025,2009]){
 const p='/draft/'+year+(year===2009?'?view=pre-draft':'');
 const resp=await page.goto(BASE+p,{waitUntil:'load'});
 check(vp.tag+' '+p+' authenticated HTTP 200',resp.status()===200&&!page.url().includes('/beta'),String(resp.status()));
 const decline=page.getByRole('button',{name:'Decline',exact:true});if(await decline.count())await decline.click();
 await page.screenshot({path:path.join(OUT,vp.tag+'-'+year+'.png')});
 if(year!==2009){
 const resp2=await page.goto(BASE+'/draft/'+year+'?view=pre-draft',{waitUntil:'load'});
 check(vp.tag+' '+year+' Pre-Draft HTTP 200',resp2.status()===200,String(resp2.status()));
 }
 const text=(await page.locator('main').innerText()).replace(/\s+/g,' ');
 const tab=page.locator('.draft-tab[aria-current="page"]');
 check(vp.tag+' '+year+' Pre-Draft tab/count',/pre-draft/.test((await tab.getAttribute('href'))||'')&&(await tab.innerText()).includes(String(expected[year].total)),await tab.innerText());
 const rows=await page.locator('table.draft-table tbody tr:not(.draft-group)').allInnerTexts();
 check(vp.tag+' '+year+' row count matches production',rows.length===expected[year].total,String(rows.length));
 for(const name of expected[year].newNames) check(vp.tag+' '+year+' inserted '+name,text.includes(name));
 const selections=await page.locator('td.draft-selection').allInnerTexts();
 check(vp.tag+' '+year+' Pre-Draft is unnumbered',selections.length>0&&selections.every(t=>!(/Pick\s+\d/.test(t))),selections.slice(0,4).join(' | '));
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
 check(vp.tag+' '+year+' no horizontal overflow',overflow<=1,String(overflow));
 check(vp.tag+' '+year+' no rendered error',!(/Application error|Internal Server Error|Something went wrong/.test(text)));
 if(year!==2009)await page.screenshot({path:path.join(OUT,vp.tag+'-'+year+'-predraft.png')});
 }
 check(vp.tag+' no page errors',errors.length===0,JSON.stringify(errors));
 check(vp.tag+' no console errors',consoleErrors.length===0,JSON.stringify(consoleErrors));
 await c.close();
 }
 const anon=await browser.newContext();
 for(const p of ['/draft/2008','/draft/2025','/draft/2009?view=pre-draft']){
 const r=await anon.request.get(BASE+p,{maxRedirects:0});
 check('beta gate preserved '+p,r.status()===307&&(r.headers().location||'').startsWith(BASE+'/beta?from='),String(r.status()));
 }await anon.close();
 const result={at:new Date().toISOString(),base:BASE,viewports:['1280x800','390x844'],checks,verdict:checks.every(x=>x.ok)?'PASS':'FAIL'};
 fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(result,null,2));
 console.log('VERDICT '+result.verdict+' '+checks.filter(x=>x.ok).length+'/'+checks.length);
 await browser.close();console.log('Browser closed; session discarded.');
})().catch(async e=>{console.error('STOP '+String(e));if(browser)await browser.close();process.exitCode=2;});
