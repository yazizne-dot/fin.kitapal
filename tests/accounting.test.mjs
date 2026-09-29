import test from 'node:test';
import assert from 'node:assert/strict';
import {ledger,debts,validate} from '../server/finance/accounting.mjs';
const op=(kind,amount,cost=0)=>({kind,amount,cost,org:'A',counterparty:'B',document:'D',date:'2026-09-01',due:'2026-09-10'});
test('credit sale accrues revenue and debt; payment never duplicates revenue',()=>{
 const sale=op('sale',1000,500);let a=ledger([sale]);assert.equal(a.revenue,1000);assert.equal(a.receivables,1000);assert.equal(a.cash,0);
 a=ledger([sale,op('receipt',1000)]);assert.equal(a.revenue,1000);assert.equal(a.receivables,0);assert.equal(a.cash,1000);assert.equal(a.difference,0);
});
test('credit purchase increases inventory and payable; settlement only moves cash and payable',()=>{
 let a=ledger([op('capital',2000),op('purchase',1000)]);assert.equal(a.inventory,1000);assert.equal(a.payables,1000);assert.equal(a.cash,2000);
 a=ledger([op('capital',2000),op('purchase',1000),op('supplier_payment',1000)]);assert.equal(a.payables,0);assert.equal(a.cash,1000);assert.equal(a.inventory,1000);assert.equal(a.difference,0);
});
test('internal transfer is excluded from aggregate inflows and outflows',()=>{
 const a=ledger([op('capital',1000),op('transfer',600)]);assert.equal(a.cash,1000);assert.equal(a.inflow,1000);assert.equal(a.outflow,0);
});
test('tax accrual and tax payment are separate events',()=>{
 let a=ledger([op('tax',500)]);assert.equal(a.profit,-500);assert.equal(a.taxes,500);assert.equal(a.cash,0);
 a=ledger([op('tax',500),op('tax_payment',500)]);assert.equal(a.profit,-500);assert.equal(a.taxes,0);assert.equal(a.cash,-500);assert.equal(a.difference,0);
});
test('balance remains equal for every supported event sequence',()=>{
 const ops=[op('capital',10000),op('loan',3000),op('asset',2000),op('purchase',5000),op('sale',4500,2500),op('receipt',4000),op('supplier_payment',3000),op('expense',600),op('expense_payment',600),op('depreciation',200),op('tax',100),op('tax_payment',100),op('return',500,250),op('loan_payment',1000),op('transfer',1500)];
 for(let i=1;i<=ops.length;i++){const a=ledger(ops.slice(0,i));assert.equal(a.difference,0);assert.equal(a.cash,a.inflow-a.outflow);assert.equal(a.cash,a.operating+a.investing+a.financing);}
});
test('debt aging retains original invoice due date after partial settlement',()=>{
 const rows=debts([op('sale',1000),{...op('receipt',700),date:'2026-09-25',due:''}],'2026-09-30');assert.equal(rows[0].amount,300);assert.equal(rows[0].days,20);
});
test('invalid amounts, dates, and unknown operations rejected',()=>{
 const valid={...op('sale',10),external_id:'1',source:'test'};assert.doesNotThrow(()=>validate(valid));for(const change of [{amount:0},{amount:-1},{amount:NaN},{amount:1.5},{date:'2026-02-30'},{kind:'unknown'},{due:'abc'}])assert.throws(()=>validate({...valid,...change}));
});
