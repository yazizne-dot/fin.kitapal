import {test}from'node:test';import assert from'node:assert/strict';
import{chooseEditorSheet,presentEditorRow}from'../../backend/reports/editor-adapter.mjs';
test('editor defaults to latest populated month and preserves explicit selection',()=>{
 const months=[{period_start:'2026-12-01',period_kind:'monthly',has_values:false},{period_start:'2026-08-01',period_kind:'monthly',has_values:true}];
 assert.equal(chooseEditorSheet(months,''),'2026-08');assert.equal(chooseEditorSheet(months,'2026-12'),'2026-12');
 assert.equal(chooseEditorSheet([{...months[1],period_start:new Date('2026-08-01T00:00:00Z')}],''),'2026-08');
});
test('source cell is readable while mutation key stays unchanged',()=>{
 const row=presentEditorRow({metric_id:'571',article_id:null,channel_id:null,label:'P&L_2026: ПРОДАЖИ/Продажи_Каспи',external_key:'pnl/P&L_2026/12/I',original:'123.45',value:'123.45'});
 assert.equal(row.cell,'571:0:0');assert.equal(row.displayCell,'P&L_2026!I12');assert.equal(row.label,'Продажи Каспи');
});
