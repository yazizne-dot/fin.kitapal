import {test}from'node:test';import assert from'node:assert/strict';
import {historicalChecks}from'../../backend/reports/historical-checks.mjs';
const figures={revenue:'100',cost:'30',gross:'70',opex:'20',operatingProfit:'50',otherExpense:'5',bonuses:'0',otherIncome:'0',taxes:'0',profit:'45',dividends:'0',retained:'45'};
const detail=(group,value)=>({group,value});
const pnl={figures,rows:Object.keys(figures).map((key,i)=>({key,external_key:`pnl/P&L_2026/${i+5}/I`}))};
test('source arithmetic checks include source and calculated sums with correct difference and references',()=>{
 const result=historicalChecks({month:'2026-07',pnl,details:[detail('revenue',100),detail('cost',30),detail('opex',25),detail('otherExpense',5)],budget:{rows:[]},issues:[]});
 assert.deepEqual(result.checks.map(c=>c.metric),['opex','operatingProfit','profit','retained']);
 assert.equal(result.checks[0].reported,20);assert.equal(result.checks[0].calculated,25);assert.equal(result.checks[0].difference,5);assert.equal(result.checks[0].sheet,'P&L_2026');
 assert.equal(result.recalculated.retained,40);
});
test('budget small source amounts and accepted inventory discrepancies remain visible without reopening issues',()=>{
 const result=historicalChecks({month:'2026-07',pnl,details:[],budget:{rows:[{label:'Налог',plan:0.1,actual:null,referenceActual:null,sources:[{plan:{sheet:'Бюджет-е 2026',cell:'T24'}}]}]},issues:[{source_ref:'inventory prepaid',as_of_date:'2026-09-01',status:'accepted',detail:JSON.stringify({original_detail:JSON.stringify({source:'100',target:'90',difference:'-10'}),resolution:'Details authoritative'})}]});
 const input=result.checks.find(x=>x.kind==='budget-input');assert.equal(input.reported,0.1);assert.equal(input.cell,'T24');
 const balance=result.checks.find(x=>x.kind==='balance-reconciliation');assert.equal(balance.reported,100);assert.equal(balance.calculated,90);assert.equal(balance.difference,-10);
});
