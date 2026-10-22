import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {chromium} from 'playwright';

const port=process.env.NEXT_TEST_PORT||'3140',base=`http://127.0.0.1:${port}`;
let server,dir,cookie,employeeCookie,employeePassword,browser,logs='';
const password='next-test-password';
async function request(path,body,session=cookie,method=body===undefined?'GET':'POST',headers={}) {
 return fetch(base+path,{method,headers:{'Content-Type':'application/json',...(session?{Cookie:session}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function login(username,pass=password){
 const response=await request('/api/login',{username,password:pass,remember:true},'');
 assert.equal(response.status,200,await response.clone().text());
 return response.headers.get('set-cookie').split(';')[0];
}
before(async()=>{
 dir=mkdtempSync(join(tmpdir(),'qarzhy-next-'));
 server=spawn(process.execPath,['node_modules/next/dist/bin/next',process.env.NEXT_TEST_DEV==='1'?'dev':'start','--hostname','127.0.0.1','--port',port],{env:{...process.env,DB_PATH:join(dir,'portal.sqlite'),PORTAL_PASSWORD:password,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){if(server.exitCode!==null)throw Error(logs);try{const r=await fetch(base);if(r.ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 throw Error('Next server startup timed out: '+logs);
});
after(async()=>{
 await browser?.close();
 if(server&&server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}
 if(dir)rmSync(dir,{recursive:true,force:true});
});
test('Next renders nonce-protected HTML without initializing the private database',async()=>{
 assert.equal(existsSync(join(dir,'portal.sqlite')),false);
 const response=await fetch(base),html=await response.text(),policy=response.headers.get('content-security-policy');
 assert.equal(response.status,200);assert.ok(html.includes('/_next/'));assert.ok(html.includes('Kitapal'));assert.ok(!html.includes(password));
 const nonce=policy.match(/'nonce-([^']+)'/)[1];assert.ok(html.includes(`nonce="${nonce}"`));assert.ok(!policy.split('script-src')[1].split(';')[0].includes("'unsafe-inline'"));
 const second=await fetch(base);assert.notEqual(second.headers.get('content-security-policy'),policy);
 assert.equal(existsSync(join(dir,'portal.sqlite')),false);
});
test('report and management routes are real Next pages and unknown routes return 404',async()=>{
 for(const path of ['/pnl','/balance','/cashflow','/users','/account','/financial-editor'])assert.equal((await fetch(base+path)).status,200,path);
 assert.equal((await fetch(base+'/not-a-portal-page')).status,404);
});
test('Next API retains authentication, cookie, account and financial-report contracts',async()=>{
 assert.equal((await request('/api/data',undefined,'')).status,401);
 cookie=await login('admin');
 const response=await request('/api/data?source=workbook&month=2026-08');assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 const data=await response.json();assert.equal(data.source,'workbook');assert.equal(data.user.role,'admin');assert.ok(data.report.revenue>0);assert.ok(data.statements.balance);
 assert.equal(data.user.password,undefined);assert.equal(data.user.salt,undefined);
});
test('Next API preserves financial mutations, conflict checks and binary exports',async()=>{
 const path='/api/data?source=workbook&month=2026-08',before=await (await request(path)).json();
 assert.equal((await request('/api/finance/entries',{date:'2026-08-15',kind:'opex',amount_cents:123456,label:'Next migration test'})).status,201);
 const changed=await (await request(path)).json();assert.ok(Math.abs(changed.report.opex-before.report.opex-1234.56)<0.001);
 const list=await (await request('/api/finance/entries')).json(),entry=list.entries.find(e=>e.label==='Next migration test');
 assert.equal((await request('/api/finance/entries',{id:entry.id,revision:list.revision-1,amount_cents:200000,reason:'stale'},cookie,'PATCH')).status,409);
 assert.equal((await request('/api/finance/entries',{id:entry.id,revision:list.revision,amount_cents:200000,reason:'next edit'},cookie,'PATCH')).status,200);
 assert.equal((await request('/api/finance/entries',{id:entry.id,reason:'cleanup'},cookie,'DELETE')).status,200);
 assert.equal((await (await request(path)).json()).report.opex,before.report.opex);
 const exported=await request('/api/export',{rows:[['Бап','Сома'],['Test',123.45]]});assert.equal(exported.status,200);assert.equal(exported.headers.get('content-type'),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');assert.ok(exported.headers.get('cache-control').includes('no-store'));assert.equal(Buffer.from(await exported.arrayBuffer()).subarray(0,2).toString(),'PK');
});
test('Next API retains CSRF, employee isolation and source-file privacy',async()=>{
 assert.equal((await request('/api/finance/entries',{date:'2026-08-15',kind:'opex',amount_cents:100,label:'Blocked'},cookie,'POST',{Origin:'https://untrusted.example'})).status,403);
 const credentials=readFileSync(join(dir,'portal.sqlite.initial-access.txt'),'utf8').split('\n').find(l=>l.startsWith('buhgalter\t')).split('\t');
 employeeCookie=await login('buhgalter',credentials[1]);employeePassword='employee-next-test';
 assert.equal((await request('/api/password',{current_password:credentials[1],new_password:employeePassword},employeeCookie)).status,200);
 const employee=await (await request('/api/data?source=workbook',undefined,employeeCookie)).json();assert.equal(employee.source,'personal');assert.equal(employee.report,undefined);
 for(const path of ['/api/users','/api/finance/editor','/api/finance/audit'])assert.equal((await request(path,undefined,employeeCookie)).status,403);
 for(const path of ['/data/portal.sqlite.initial-access.txt','/data/workbook-source.json','/server/portal.mjs','/app.js'])assert.equal((await fetch(base+path)).status,404);
});
test('React login, report navigation, dialogs, languages, logout and employee cabinet work in the browser',async()=>{
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 const context=await browser.newContext();const page=await context.newPage();const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error'&&/Content Security Policy|hydration/i.test(message.text()))errors.push(message.text());});
 await page.goto(base);
 await page.locator('#login-form').waitFor();
 await page.locator('[name="username"]').fill('admin');await page.locator('[name="password"]').fill(password);
 await page.locator('#show-login-password').check();assert.equal(await page.locator('[name="password"]').getAttribute('type'),'text');await page.locator('#show-login-password').uncheck();
 await page.locator('[name="remember"]').check();await page.locator('#login-form button[type="submit"]').click();
 await page.locator('[data-page="pnl"]').first().waitFor();
 assert.ok((await context.cookies()).some(c=>c.name==='session'&&c.httpOnly&&c.expires>0));
 for(const section of ['pnl','balance','cashflow','users','employee-expenses','financial-entries','financial-editor']){
  await page.locator(`[data-page="${section}"]`).first().click();await page.waitForFunction(()=>document.querySelector('.content')&&!document.querySelector('.content .loading'));
  assert.ok(!await page.locator('.content').innerText().then(s=>s.includes('undefined')||s.includes('NaN')),section);
 }
 await page.locator('[data-page="financial-entries"]').first().click();await page.locator('[data-admin="add-entry"]').click();
 await page.locator('#finance-entry-form').waitFor();await page.locator('#modal [data-action="close"]').first().click();
 await page.locator('#app-language').selectOption('ru');await page.waitForFunction(()=>document.documentElement.lang==='ru');
 await page.locator('#app-language').selectOption('kk');await page.waitForFunction(()=>document.documentElement.lang==='kk');
 await page.locator('[data-action="logout"]').click();await page.locator('#login-form').waitFor();
 await page.locator('[name="username"]').fill('buhgalter');await page.locator('[name="password"]').fill(employeePassword);await page.locator('#login-form button[type="submit"]').click();
 await page.locator('[data-admin="add-expense"]').waitFor();assert.equal(await page.locator('[data-page="pnl"]').count(),0);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('.mobile-menu').isVisible());
 assert.deepEqual(errors,[]);await context.close();
});
test('logout through Next revokes the session',async()=>{
 assert.equal((await request('/api/logout',{},cookie)).status,200);assert.equal((await request('/api/me',undefined,cookie)).status,401);
});
