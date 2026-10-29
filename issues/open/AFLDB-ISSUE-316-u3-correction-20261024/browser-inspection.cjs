const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:false});
 const context=await browser.newContext();
 const page=await context.newPage();
 await page.goto('https://beta.afldb.com/admin/data-editor?mode=match-sheet&id=17214',{waitUntil:'domcontentloaded'});
 console.log(JSON.stringify({phase:'opened',url:page.url(),title:await page.title()}));
 // No form fills, clicks or save requests. Operator signs in if needed.
 for(let i=0;i<120;i++){
  if(new URL(page.url()).pathname==='/admin/data-editor' && await page.locator('input[name="note"]').count()){
   const note=page.locator('input[name="note"]');
   const result={phase:'inspected',url:page.url(),note:await note.evaluate(e=>({name:e.name,type:e.type,maxLength:e.maxLength,label:e.closest('label')?.innerText,formAction:e.form?.getAttribute('action'),submitLabels:[...e.form.querySelectorAll('button[type="submit"]')].map(b=>b.innerText)})),saveClicked:false};
   const auditPage=await context.newPage();
   await auditPage.goto('https://beta.afldb.com/admin/audit/entity/matches/17214',{waitUntil:'domcontentloaded'});
   result.audit={url:auditPage.url(),text:(await auditPage.locator('body').innerText()).slice(0,15000),forms:await auditPage.locator('form').evaluateAll(es=>es.map(e=>({method:e.method,action:e.getAttribute('action')})))};
   fs.writeFileSync(path.join(__dirname,'browser-inspection.json'),JSON.stringify(result,null,2)+'\n');
   console.log(JSON.stringify({phase:'inspected',note:result.note,auditForms:result.audit.forms}));
   await browser.close();return;
  }
  await new Promise(r=>setTimeout(r,5000));
 }
 console.log('Authentication not completed; no authenticated inspection performed.');
 await browser.close();
})().catch(e=>{console.error(e.message);process.exitCode=1});
