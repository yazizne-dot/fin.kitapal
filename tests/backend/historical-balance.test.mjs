import {test} from 'node:test';
import assert from 'node:assert/strict';
import {presentHistoricalBalance} from '../../backend/reports/historical-balance.mjs';
test('historical draft shows original snapshot date and source amounts without approval or projection',()=>{
 const result=presentHistoricalBalance({id:'1',as_of_date:'2026-09-01',status:'draft'},[
  {name:'Деньги',external_key:'balance/main/5',value:'212345559'},
  {name:'Активы',external_key:'balance/main/12',value:'731964572.06'},
  {name:'Капитал',external_key:'balance/main/19',value:'622859776.46'},
 ]);
 assert.equal(result.date,'2026-09-01');assert.equal(result.snapshotStatus,'draft');
 assert.equal(result.rows.find(x=>x.id==='cash').value,212345559);
 assert.equal(result.rows.find(x=>x.id==='assets').source.cell,'C12');
 assert.equal(result.historical,true);assert.match(result.metadata.limitations.join(' '),/не утверждён/);
 assert.equal(result.rows.some(x=>x.id==='liabilities'),false);
});

test('historical lookup stays scoped and returns no snapshot instead of inventing totals',async()=>{
 const {getHistoricalBalance}=await import('../../backend/reports/historical-balance.mjs');
 const calls=[];const pool={query:async(sql,args)=>{calls.push({sql,args});return {rows:sql.includes('report_scopes')?[{organization_id:null}]:[]};}};
 const result=await getHistoricalBalance({pool,principal:{permissions:['finance.read']},scopeId:'1',datasetId:'2'});
 assert.equal(result,null);assert.equal(calls.length,2);
 assert.match(calls[1].sql,/b.scope_id=\$1 AND b.dataset_id=\$2/);
 assert.deepEqual(calls[1].args,['1','2']);
});
