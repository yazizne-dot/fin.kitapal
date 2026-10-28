import {requirePermission} from '../auth/guards.mjs';
import {assertReportScope} from './access.mjs';
const ids={5:'cash',7:'inventory',8:'fixed',9:'receivable-wholesale',10:'receivable-distributors',11:'receivable-employees',12:'assets',15:'payables',16:'financial-liabilities',17:'liabilities',19:'equity',21:'total'};
export function presentHistoricalBalance(snapshot,rows){
 return {date:snapshot.as_of_date,asOfLabel:snapshot.as_of_date,historical:true,snapshotStatus:snapshot.status,
  metadata:{file:'PostgreSQL · исторический свод баланса',limitations:[
   'Исторический свод исходного файла. Снимок не утверждён как начальный баланс; движения после его даты не добавлены.',
   'Свод товаров и обязательств сохранён для истории. Для товарного учёта используются детальные позиции; принятые расхождения показаны в разделе «Проверка данных».']},
  rows:rows.flatMap(row=>{const m=/^balance\/main\/(\d+)$/.exec(row.external_key??'');if(!m)return[];
   return [{id:ids[m[1]]??`source-${m[1]}`,label:row.name,value:row.value==null?null:Number(row.value),source:{sheet:'Баланс',cell:`C${m[1]}`,period:snapshot.as_of_date}}];}),
  cashAccounts:[],suppliers:[],assetGroups:[],inventory:[],checks:[],capitalIsResidual:true};
}
export async function getHistoricalBalance({pool,principal,scopeId,datasetId}){
 requirePermission(principal,'finance.read');const scope=await assertReportScope(pool,principal,scopeId);
 const snapshots=(await pool.query(`SELECT b.id,b.as_of_date::text,b.status FROM qarzhy.balance_snapshots b JOIN qarzhy.datasets d ON d.id=b.dataset_id WHERE b.scope_id=$1 AND b.dataset_id=$2 AND d.kind='imported_finance' ORDER BY b.as_of_date DESC,b.id DESC LIMIT 1`,[scope,datasetId])).rows;
 if(!snapshots.length)return null;
 const snapshot=snapshots[0];
 const rows=(await pool.query(`SELECT m.name,h.value::text,h.external_key FROM qarzhy.historical_series s JOIN qarzhy.historical_values h ON h.series_id=s.id JOIN qarzhy.report_metrics m ON m.id=s.metric_id WHERE s.scope_id=$1 AND s.dataset_id=$2 AND s.report_family='balance' AND h.period_kind='snapshot' AND h.period_start=$3 AND h.external_key LIKE 'balance/main/%' ORDER BY h.id`,[scope,datasetId,snapshot.as_of_date])).rows;
 return rows.length?presentHistoricalBalance(snapshot,rows):null;
}
