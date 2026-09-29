import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workbookDataset as w} from '../server/finance/workbook.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<.015,`${a} != ${b}`);
test('August P&L uses original workbook totals with decimal precision',()=>{
 const d=w.report();assert.equal(d.latest,'2026-08');assert.equal(d.source,'workbook');assert.equal(d.demo,false);close(d.report.revenue,49067743.11);close(d.report.cost,23731036.19);close(d.report.gross,25336706.92);close(d.report.opex,25985301);close(d.report.profit,-5217423.746666668);assert.equal(d.refs.revenue[0].cell,'J16');assert.equal(d.refs.profit[0].cell,'J110');
});
test('missing technical support is surfaced, not silently edited',()=>{
 const d=w.report();close(d.recalculated.opex-d.report.opex,771944);close(d.recalculated.profit,-5989367.746666668);assert.ok(d.checks.some(x=>x.metric==='opex'&&x.cell==='J67'));const july=w.report({month:'2026-07'});close(july.recalculated.opex-july.report.opex,2719502);
});
test('full YTD uses the actual O column and flags monthly rollup discrepancy',()=>{
 const d=w.report({range:'ytd'});assert.equal(d.aggregation,'year-total');close(d.report.revenue,592738442.3);close(d.report.opex,244935736);close(d.report.profit,-6647289.243333593);assert.equal(d.refs.profit[0].cell,'O110');assert.ok(d.checks.some(x=>x.kind==='annual-rollup'&&x.metric==='profit'));close(d.previous.revenue,Array.from({length:8},(_,i)=>w.monthly.get(`2025-0${i+1}`).metrics.revenue).reduce((a,b)=>a+b,0));
 const partial=w.report({month:'2026-06',range:'ytd'});assert.equal(partial.aggregation,'monthly-sum');
});
test('company budget uses its own scope and does not become cashflow',()=>{
 const d=w.report(),opex=d.budgetRows.find(x=>x.id==='21');close(opex.plan,30450000);close(opex.actual,26755245);assert.equal(d.report.cash,undefined);assert.equal(d.balance,undefined);assert.equal(d.debts,undefined);assert.ok(d.checks.some(c=>c.kind==='formula-reference'&&c.cell==='X23'));
});
test('future months have budgets but no invented actuals',()=>{
 const d=w.report({month:'2026-09'});assert.equal(d.actualAvailable,false);assert.equal(d.report.revenue,null);assert.equal(d.report.profit,null);assert.ok(d.budgetRows.some(r=>r.plan>0));assert.ok(d.budgetRows.every(r=>r.actual===null));const y=w.report({month:'2026-12',range:'ytd'});assert.equal(y.actualThrough,'2026-08');close(y.report.revenue,592738442.3);close(y.previous.revenue,w.report({month:'2026-08',range:'ytd'}).previous.revenue);
});
test('channel totals reconcile and do not invent allocated operating costs',()=>{
 const d=w.report();assert.equal(d.channels.length,11);close(d.channels.reduce((s,r)=>s+r.revenue,0),d.report.revenue);close(d.channels.reduce((s,r)=>s+r.cost,0),d.report.cost);
 const k=w.report({channel:'Продажи_Каспи'});close(k.report.revenue,9360279.03);close(k.report.cost,4007343.14);assert.equal(k.report.opex,null);assert.equal(k.report.profit,null);assert.deepEqual(k.budgetRows,[]);assert.ok(k.details.every(x=>x.label==='Продажи_Каспи'));
});
test('negative return-related values and tiny source budget inputs are preserved',()=>{
 const d=w.report({month:'2026-03',channel:'Продажи_Экстра'});close(d.report.revenue,-108932.3);close(d.report.cost,-221177.66);
 const b=w.report({month:'2026-03'});assert.ok(b.budgetRows.some(x=>x.plan===.1));assert.ok(b.checks.some(x=>x.kind==='budget-input'));
});
test('every reported metric has source provenance and missing inputs stay distinct from zero',()=>{
 const d=w.report();assert.ok(d.details.every(r=>r.sources.every(s=>s.sheet&&s.cell)));const blank=d.details.find(x=>x.group==='bonuses'&&x.label==='Ақтау фр');assert.equal(blank.value,null);assert.equal(d.report.bonuses,0);assert.ok(d.metadata.sha256.length===64);assert.throws(()=>w.report({month:'2027-01'}));assert.throws(()=>w.report({month:'2026-08',channel:'unknown'}));
});
