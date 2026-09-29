import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {ledger,kinds} from '../accounting.mjs';
import * as administrationUI from '../public/administration.js';
import * as i18nUI from '../public/i18n.js';
import * as workbookUI from '../public/workbook.js';
const appSource=()=>readFileSync('public/app.js','utf8').replace(/^import .*;\n/gm,'');
test('all application pages render against the API contract without runtime errors',async()=>{
 const root={innerHTML:''};const element={classList:{add(){},remove(){}},innerHTML:'',textContent:''};
 const data={user:{name:'Қаржыгер',role:'finance'},orgs:['Qalam Books','Kitap Retail','Dara Distribution'],kinds,month:'2026-09',end:'2026-09-30',operations:[],allOperations:[],report:ledger([]),previous:ledger([]),opening:ledger([]),balance:ledger([]),budget:[],history:Array.from({length:9},(_,i)=>({month:`2026-0${i+1}`,...ledger([])})),debts:[],plans:[],audit:[],closed:false,demo:true};
 const context=vm.createContext({...workbookUI,...administrationUI,...i18nUI,console,Intl,Date,URL,Blob,setTimeout,clearTimeout,location:{hash:''},window:{addEventListener(){},scrollTo(){}},document:{querySelector:s=>s==='#app'?root:element,addEventListener(){}},fetch:async()=>({ok:true,json:async()=>data})});
 vm.runInContext(appSource(),context);await new Promise(resolve=>setImmediate(resolve));
 for(const page of ['dashboard','pnl','balance','cashflow','debts','analytics','plans','operations','imports','audit','settings']){vm.runInContext(`state.page='${page}';render()`,context);assert.ok(root.innerHTML.includes('class="content"'),page);assert.ok(!root.innerHTML.includes('NaN'),page);assert.ok(!root.innerHTML.includes('undefined'),page);}
 vm.runInContext("state.data.user.role='manager';state.data.user.org='Kitap Retail';state.data.user.point='Астана';state.data.orgs=['Kitap Retail'];state.page='dashboard';render()",context);assert.ok(root.innerHTML.includes('Kitap Retail'));
});
test('login submits even when the user select shadows the form id property',async()=>{
 const listeners={},requests=[],button={disabled:false},error={innerHTML:''},root={innerHTML:''};
 const context=vm.createContext({...workbookUI,...administrationUI,...i18nUI,console,Intl,Date,URL,Blob,setTimeout,clearTimeout,location:{hash:''},window:{addEventListener(){},scrollTo(){}},FormData:class{constructor(){return new Map([['id','1'],['password','demo2026']]);}},document:{querySelector:s=>s==='#app'?root:{close(){},classList:{add(){},remove(){}}},addEventListener:(name,fn)=>listeners[name]=fn},fetch:async(url,options)=>{requests.push({url,options});return {ok:false,status:401,json:async()=>({error:'Жүйеге кіріңіз'})};}});
 vm.runInContext(appSource(),context);await new Promise(resolve=>setImmediate(resolve));
 // Browser named-property behavior: <select name="id"> shadows form.id.
 const form={id:{tagName:'SELECT'},getAttribute:name=>name==='id'?'login-form':null,querySelector:s=>s.includes('button')?button:error};
 await listeners.submit({preventDefault(){},target:form});
 const request=requests.find(r=>r.url==='/api/login');assert.ok(request,'login API must be called');assert.deepEqual(JSON.parse(request.options.body),{id:'1',password:'demo2026'});assert.equal(button.disabled,false);assert.ok(error.innerHTML.includes('Жүйеге кіріңіз'));
});
test('private workspace exposes expenses and profile without company navigation',()=>{
 const root={innerHTML:''},state={page:'dashboard',data:{user:{id:5,name:'Бухгалтер',username:'buhgalter',role:'employee',language:'kk'},expenses:[]}};
 const c={root,state,icon:()=>'',esc:s=>String(s??'')};administrationUI.renderPersonal(c);
 assert.ok(root.innerHTML.includes('Менің шығындарым'));assert.ok(!root.innerHTML.includes('data-page="pnl"'));assert.ok(!root.innerHTML.includes('data-page="users"'));assert.ok(root.innerHTML.includes('add-expense'));
 state.data.user.must_change_password=1;administrationUI.renderPersonal(c);assert.ok(root.innerHTML.includes('password-form'));assert.ok(!root.innerHTML.includes('add-expense'));
});
test('management pages and credential forms render for admin and finance',()=>{
 const fixtures={users:{users:[{id:2,name:'Test',username:'test',role:'employee',active:1}]},'employee-expenses':{expenses:[]},'financial-editor':{books:[{id:'pnl',file:'Source'}],sheets:['Sheet'],sheet:'Sheet',book:'pnl',rows:[{cell:'A1',value:1,original:1,label:'Test'}],offset:0,total:1,revision:1},'financial-entries':{entries:[{id:1,date:'2026-08-01',kind:'opex',label:'Test',amount_cents:100}],revision:1},'admin-audit':{audit:[]},account:{}};
 for(const role of ['admin','finance'])for(const [page,data] of Object.entries(fixtures)){const root={innerHTML:''},state={page,management:{key:page,data},data:{user:{id:1,name:'Test',username:'test',role,language:'kk'}}};administrationUI.renderManagement({root,state,icon:()=>'',esc:s=>String(s??'')});assert.ok(root.innerHTML.includes('class="content"'),page);assert.ok(!root.innerHTML.includes('undefined'),page);assert.ok(!root.innerHTML.includes('NaN'),page);}
});
test('interface translation changes both directions without modifying stored data',()=>{
 i18nUI.setLanguage('ru');assert.equal(i18nUI.t('Менің шығындарым'),'Мои расходы');assert.equal(i18nUI.t('Құпиясөз'), 'Пароль');assert.equal(i18nUI.t('Жұмыс кеңістігі / Жеке кабинет'),'Рабочее пространство / Личный кабинет');assert.ok(i18nUI.languageControl().includes('value="ru" selected'));i18nUI.setLanguage('kk');assert.equal(i18nUI.t('Менің шығындарым'),'Менің шығындарым');
});
test('login password visibility toggles without changing the entered password',async()=>{
 const listeners={},root={innerHTML:''},password={type:'password',value:'a-private-password'};
 const context=vm.createContext({...workbookUI,...administrationUI,...i18nUI,console,Intl,Date,URL,Blob,setTimeout,clearTimeout,location:{hash:''},window:{addEventListener(){}},document:{querySelector:s=>s==='#app'?root:s==='#login-password'?password:{classList:{add(){},remove(){}}},addEventListener:(name,fn)=>listeners[name]=fn},fetch:async()=>({ok:false,status:401,json:async()=>({error:'Login required'})})});vm.runInContext(appSource(),context);await new Promise(resolve=>setImmediate(resolve));assert.ok(root.innerHTML.includes('name="remember"'));assert.ok(root.innerHTML.includes('id="show-login-password"'));
 await listeners.change({target:{id:'show-login-password',checked:true}});assert.equal(password.type,'text');assert.equal(password.value,'a-private-password');await listeners.change({target:{id:'show-login-password',checked:false}});assert.equal(password.type,'password');assert.equal(password.value,'a-private-password');
});
