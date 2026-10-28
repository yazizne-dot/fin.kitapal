import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historicalReportDetails,aggregateReportDetails} from '../../backend/reports/historical-details.mjs';
const row=(n,label,value,key=null,section='АДМИНИСТРАТИВНЫЕ РАСХОДЫ')=>({metric_id:String(n),name:`P&L_2026: ${section}/${label}`,external_key:`pnl/P&L_2026/${n}/I`,original:value,value,key,override_value:null});
const rows=[row(5,'Продажи_Каспи','10',null,'ВЫРУЧКА ОТ РЕАЛИЗАЦИИ'),row(16,'ТОТАЛ ВЫРУЧКА','10','revenue'),row(25,'Продажи_Каспи','4',null,'СЕБЕСТОИМОСТЬ РЕАЛИЗОВАННОЙ ПРОДУКЦИИ'),row(36,'ИТОГО СЕБЕСТОИМОСТЬ','4','cost'),row(48,'Расходы_на_ЗП','2'),row(67,'ИТОГО АДМИНИСТРАТИВНЫЕ','2','opex'),row(77,'ПРОЧИЕ РАСХОДЫ','1','otherExpense'),row(78,'Амортизация ОС','1'),row(82,'НАЛОГИ','0','taxes'),row(83,'Налог',null),row(86,'РЕТРО-БОНУСЫ ДИСТРАМ','0','bonuses'),row(87,'Экстра','0'),row(99,'ПРОЧИЕ ДОХОДЫ','0','otherIncome'),row(106,'Экстра (строка группы 2)','0'),row(110,'ЧИСТАЯ ПРИБЫЛЬ','3','profit'),row(115,'ИТОГО НЕРАСПРЕДЕЛЁННАЯ','3','retained')];
test('historical report shows detail lines, groups and original source cells rather than aggregate totals',()=>{
 const details=historicalReportDetails(rows,'2026-07');
 assert.deepEqual(details.map(x=>x.group),['revenue','cost','opex','otherExpense','taxes','bonuses','otherIncome']);
 assert.equal(details[0].display,'Kaspi');assert.equal(details[2].display,'Расходы на ЗП');
 assert.equal(details[0].sources[0].sheet,'P&L_2026');assert.equal(details[0].sources[0].cell,'I5');
 assert.equal(details[4].value,null);assert.equal(details[5].value,0);
 assert.equal(details[6].label,'Экстра');assert.notEqual(details[5].id,details[6].id);
 assert.equal(historicalReportDetails(rows,'2026-07','Продажи_Каспи').length,2);
});
test('YTD details combine matching articles with all monthly references and preserve unknown amounts',()=>{
 const a=historicalReportDetails(rows,'2026-07'),b=historicalReportDetails(rows,'2026-08');
 const combined=aggregateReportDetails([a,b]);assert.equal(combined[0].value,20);assert.equal(combined[0].sources.length,2);assert.equal(combined[4].value,null);
});

test('annual-only article metadata supplies blank monthly lines, never annual amounts',async()=>{
 const {getHistoricalReportDetails}=await import('../../backend/reports/historical-details.mjs');
 const pool={async query(){return{rows:[{metric_id:'113',name:'P&L_2026: АДМИНИСТРАТИВНЫЕ РАСХОДЫ/Дивиденды/выплаты учредителю 1',external_key:'pnl/P&L_2026/113/O',value:'9999'},{metric_id:'500',name:'P&L_2026: ВЫРУЧКА ОТ РЕАЛИЗАЦИИ/Продажи_Каспи / Расчётная доля',external_key:'pnl/P&L_2026/5/B'}]}}};
 const details=await getHistoricalReportDetails({pool,pnl:{rows,datasetId:'2'},scopeId:'1',month:'2026-07'});
 const dividend=details.find(x=>x.group==='dividends');assert.ok(dividend);assert.equal(dividend.value,null);assert.equal(dividend.sources[0].cell,'I113');assert.equal(details.some(x=>x.label.includes('Расчётная доля')),false);
});

test('article aggregation preserves fractional source precision across monthly and YTD views',()=>{
 const row={id:'otherExpense:Амортизация ОС',value:0.004,sources:[]};
 const monthly=aggregateReportDetails([[row]]);
 assert.equal(aggregateReportDetails([monthly,monthly,monthly])[0].value,0.012);
});
