import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historicalChannels} from '../../backend/reports/sales.mjs';
const row=(section,label,value,id='1')=>({metric_id:id,name:`P&L_2026: ${section}/${label}`,value,original:value,override_value:null});
test('imported P&L channels keep Excel labels, zeroes, nulls and exact gross',()=>{
 const channels=historicalChannels([
  row('ВЫРУЧКА ОТ РЕАЛИЗАЦИИ','Продажи_по_магазинам_Kitapal_Үшсұңқар','100.10'),
  row('СЕБЕСТОИМОСТЬ РЕАЛИЗОВАННОЙ ПРОДУКЦИИ','Продажи_по_магазинам_Kitapal_Үшсұңқар','40.03','2'),
  row('ВЫРУЧКА ОТ РЕАЛИЗАЦИИ','Продажи_Тендер','0','3'),
  row('СЕБЕСТОИМОСТЬ РЕАЛИЗОВАННОЙ ПРОДУКЦИИ','Продажи_Тендер','0','4'),
  row('ВЫРУЧКА ОТ РЕАЛИЗАЦИИ','Продажи_Каспи','25','5'),
  row('ВЫРУЧКА ОТ РЕАЛИЗАЦИИ','ТОТАЛ ВЫРУЧКА','125.10','6'),
  row('АДМИНИСТРАТИВНЫЕ РАСХОДЫ','Продажи_Маркетинг','7','7'),
 ],'2026-08');
 assert.deepEqual(channels.map(c=>c.label),['Kitapal · Үшсұңқар','Тендер','Kaspi']);
 assert.equal(channels[0].gross,60.07);assert.equal(channels[1].gross,0);
 assert.equal(channels[2].cost,null);assert.equal(channels[2].gross,null);
 assert.equal(channels[0].id,'Продажи_по_магазинам_Kitapal_Үшсұңқар');
 assert.equal(channels[0].sources[0].period,'2026-08');
});
test('ambiguous or unavailable historical channel amounts never become invented zeroes',()=>{
 const [c]=historicalChannels([row('ВЫРУЧКА ОТ РЕАЛИЗАЦИИ','Продажи_Каспи','10'),row('ВЫРУЧКА ОТ РЕАЛИЗАЦИИ','Продажи_Каспи','20','2'),row('СЕБЕСТОИМОСТЬ РЕАЛИЗОВАННОЙ ПРОДУКЦИИ','Продажи_Каспи',null,'3')],'2026-08');
 assert.equal(c.revenue,null);assert.equal(c.cost,null);assert.equal(c.gross,null);
});
