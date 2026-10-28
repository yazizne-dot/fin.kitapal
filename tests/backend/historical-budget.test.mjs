import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getBudgetPeriod} from '../../backend/reports/planning.mjs';
const value=(id,name,key,amount)=>({id:String(id),name:`Бюджет-е 2026: ${name}`,external_key:`pnl/Бюджет-е 2026/${key}`,period_start:'2026-07-01',original:amount,override_value:null,unit:'amount'});
function poolFor(rows){return{async query(sql){
 if(sql.includes('SELECT organization_id FROM qarzhy.report_scopes'))return{rows:[{organization_id:null}]};
 if(sql.includes('historical_series')&&sql.includes("report_family='budget'"))return{rows};
 return{rows:[]};
}}}
const principal={permissions:['finance.read']};
test('historical budgets expose imported plan and actual without approving a live budget',async()=>{
 const pool=poolFor([value(1,'Расходы_на_ЗП','4/T','12500000'),value(2,'Расходы_на_ЗП','4/U','10643710'),value(3,'Тотал','25/T','14000000'),value(4,'Тотал','25/U','11000000')]);
 const result=await getBudgetPeriod({pool,principal,scopeId:'1',start:'2026-07-01',end:'2026-08-01',pnl:{source:'historical',datasetId:'2',rows:[]}});
 assert.equal(result.rows.length,2);assert.equal(result.rows[0].display,'Расходы на ЗП');
 assert.equal(result.rows[0].plan,12500000);assert.equal(result.rows[0].actual,10643710);
 assert.equal(result.rows[1].total,true);assert.equal(result.timeline.find(x=>x.month==='2026-07').plan,14000000);
 assert.equal(result.versionId,undefined);assert.match(result.warnings.join(' '),/historical|import/i);
});
test('historical budget preserves missing values, zeroes and overrides, excluding fulfilment ratios',async()=>{
 const rows=[value(1,'Статья','4/T',null),{...value(2,'Статья','4/U','10'),override_value:'0'},value(3,'Статья','4/V','0.5')];
 const r=await getBudgetPeriod({pool:poolFor(rows),principal,scopeId:'1',start:'2026-07-01',end:'2026-08-01',pnl:{source:'historical',datasetId:'2',rows:[]}});
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].plan,null);assert.equal(r.rows[0].actual,0);
});
test('live budgets still require approved budget coverage',async()=>{
 const r=await getBudgetPeriod({pool:poolFor([]),principal,scopeId:'1',start:'2026-07-01',end:'2026-08-01',pnl:{source:'events'}});
 assert.deepEqual(r.rows,[]);assert.match(r.warnings.join(' '),/coverage/);
});

test('YTD historical budget sums monthly values and retains missing facts and source references',async()=>{
 const {aggregateHistoricalBudgetRows}=await import('../../backend/reports/planning.mjs');
 const a={id:'4',label:'ЗП',plan:100,actual:null,referenceActual:null,sources:[{period:'2026-01'}]};
 const b={...a,plan:200,actual:50,sources:[{period:'2026-02'}]};
 const [r]=aggregateHistoricalBudgetRows([{rows:[a]},{rows:[b]}]);
 assert.equal(r.plan,300);assert.equal(r.actual,50);assert.equal(r.referenceActual,null);assert.equal(r.sources.length,2);
});

test('YTD rounds only after summing fractional source amounts',async()=>{
 const {aggregateHistoricalBudgetRows}=await import('../../backend/reports/planning.mjs');
 const period={rows:[{id:'4',plan:0.004,actual:null,referenceActual:null,sources:[]}]};
 assert.equal(aggregateHistoricalBudgetRows([period,period,period])[0].plan,0.01);
});
