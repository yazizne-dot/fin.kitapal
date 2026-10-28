import {Exact} from '../finance/validation.mjs';
import {calculatePnl} from './pnl.mjs';
const inputs=['revenue','cost','opex','otherExpense','bonuses','otherIncome','taxes','dividends'];
const labels={revenue:'Выручка',cost:'Себестоимость',gross:'Валовая прибыль',opex:'Операционные расходы',operatingProfit:'Операционная прибыль',otherExpense:'Прочие расходы',taxes:'Налоги',bonuses:'Бонусы',otherIncome:'Прочие доходы',profit:'Чистая прибыль',dividends:'Дивиденды',retained:'Нераспределённая прибыль'};
const number=value=>value==null?null:Number(value);
function source(key){const m=/^pnl\/(P&L_\d{4})\/(\d+)\/([A-Z]+)$/.exec(key??'');return m?{sheet:m[1],cell:m[3]+m[2]}:{sheet:'PostgreSQL',cell:''};}
export function historicalChecks({month,pnl,details,budget,issues=[]}){
 const base=Object.fromEntries(inputs.map(key=>[key,details.filter(row=>row.group===key&&row.value!=null).reduce((sum,row)=>sum.plus(row.value),new Exact(0)).toFixed(8)]));
 // A missing dividend breakdown may only use the amount established by saved totals.
 if(!details.some(row=>row.group==='dividends'&&row.value!=null)) base.dividends=pnl.figures.dividends==null?null:String(pnl.figures.dividends);
 const calculated=calculatePnl(base),checks=[];
 for(const [metric,label]of Object.entries(labels)){
  const reported=pnl.figures[metric],value=calculated[metric];
  if(reported==null||value==null)continue;
  const difference=new Exact(value).minus(reported);if(difference.abs().lessThan('0.02'))continue;
  checks.push({period:month,kind:'arithmetic',metric,title:`${label}: итог не совпадает с суммой статей`,reported:number(reported),calculated:number(value),difference:Number(difference.toFixed(2)),...source(pnl.rows.find(row=>row.key===metric)?.external_key),detail:'Основной показатель сохраняет итог исходного файла. Пересчёт по детальным статьям показан отдельно.'});
 }
 for(const row of budget.rows??[])if(row.plan>0&&row.plan<1){
  checks.push({period:month,kind:'budget-input',title:'В бюджете есть сумма меньше 1 тенге',reported:row.plan,calculated:null,difference:null,...row.sources?.[0]?.plan,detail:`${row.label}: исходная сумма сохранена без преобразования в процент.`});
 }
 for(const issue of issues){
  if(!['inventory prepaid','inventory consignment'].includes(issue.source_ref)||!issue.as_of_date)continue;
  let outer,original;try{outer=JSON.parse(issue.detail);original=typeof outer.original_detail==='string'?JSON.parse(outer.original_detail):outer.original_detail;}catch{continue;}
  if(!original||![original.source,original.target].every(value=>value!=null&&Number.isFinite(Number(value))))continue;
  checks.push({period:issue.as_of_date,kind:'balance-reconciliation',title:issue.source_ref==='inventory prepaid'?'Товары по предоплате: свод и детализация расходятся':'Товары на реализации: свод и детализация расходятся',reported:Number(original.source),calculated:Number(original.target),difference:Number(new Exact(original.target).minus(original.source).toFixed(2)),sheet:'Баланс',cell:issue.source_ref==='inventory prepaid'?'C7':'C15',detail:issue.status==='accepted'?'Расхождение принято: по вашему решению используются детальные товарные строки; свод сохранён для истории.':'Сравнение исходного свода с детализацией товаров.'});
 }
 return{checks,recalculated:Object.fromEntries(Object.entries(calculated).filter(([key])=>key!=='reconciliation').map(([key,value])=>[key,number(value)]))};
}
export async function getHistoricalIssues(pool,datasetId,scopeId){return(await pool.query(`SELECT i.source_ref,i.detail,i.status,b.as_of_date::text FROM qarzhy.import_issues i JOIN qarzhy.balance_snapshots b ON b.import_batch_id=i.import_batch_id WHERE b.dataset_id=$1 AND b.scope_id=$2 AND i.code='source_total_mismatch' AND i.source_ref IN ('inventory prepaid','inventory consignment')`,[datasetId,scopeId])).rows;}
export const missingHistoricalChecks=['Формулы бюджетных ячеек не перенесены в PostgreSQL: проверка ссылок на листы других лет недоступна.','Контрольная месячная сводка ДДС не перенесена в PostgreSQL: сверка сводки с денежными движениями недоступна.'];
