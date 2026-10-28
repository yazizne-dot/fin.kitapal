import {Exact} from '../finance/validation.mjs';

const labels = {'Продажи_по_дитрибьюторам':'Дистрибьюторлар','Продажи_интернет_операторы':'Интернет операторлар',
  'Продажи_оптовые':'Көтерме сату','Продажи_Каспи':'Kaspi','Продажи_Сайт':'Сайт','Продажи_Тендер':'Тендер','Продажи_Экстра':'Экстра'};
function displayLabel(label, group) {
  if (['revenue','cost'].includes(group)) {
    if (label.startsWith('Продажи_по_магазинам_')) return label.slice('Продажи_по_магазинам_'.length).replaceAll('_',' · ');
    if (labels[label]) return labels[label];
  }
  return label.replaceAll('_',' ');
}

export function historicalReportDetails(rows, month, channel = '') {
  const entries = rows.flatMap(row => {
    const origin = /^pnl\/(P&L_\d{4})\/(\d+)\/([A-Z]+)$/.exec(row.external_key ?? '');
    if (!origin) return [];
    const path = row.name.slice(row.name.indexOf(':')+1).trim(), slash = path.indexOf('/');
    const label = (slash < 0 ? path : path.slice(slash+1)).replace(/\s*\(строка группы \d+\)$/, '').replace(/\s+/g,' ').trim();
    return [{row, sheet:origin[1], n:Number(origin[2]), cell:origin[3]+origin[2], section:slash < 0 ? '' : path.slice(0,slash), label}];
  });
  entries.sort((a,b)=>a.n-b.n);
  const totals = Object.fromEntries(entries.filter(e=>e.row.key).map(e=>[e.row.key,e.n]));
  return entries.flatMap(({row,sheet,n,cell,section,label}) => {
    if (row.key || label.includes('ПРИБЫЛЬ ОТ РЕАЛИЗАЦИИ')) return [];
    let group = null;
    if (n>=5 && n<totals.revenue) group='revenue';
    else if (section.startsWith('СЕБЕСТОИМОСТЬ') && n<totals.cost) group='cost';
    else if (section.startsWith('АДМИНИСТРАТИВНЫЕ') && n<totals.opex) group='opex';
    else for (const [key, lower, upper, offset] of [
      ['otherExpense','otherExpense','taxes',0],['taxes','taxes','bonuses',0],
      ['bonuses','bonuses','otherIncome',0],['otherIncome','otherIncome','profit',0],
      ['dividends','profit','retained',1],
    ]) if(n>totals[lower]+offset && n<totals[upper]) {group=key;break;}
    if (!group || channel && (!['revenue','cost'].includes(group) || label!==channel)) return [];
    return [{id:`${group}:${label}`,label,display:displayLabel(label,group),group,
      value:row.value===null||row.value===undefined?null:Number(row.value),manual:row.override_value!==null,
      sources:[{period:month,sheet,cell,value:row.original===null||row.original===undefined?null:Number(row.original),raw:row.original}]}];
  });
}

export function aggregateReportDetails(periods) {
  const grouped = new Map();
  for (const details of periods) for (const detail of details) {
    const row=grouped.get(detail.id)??{...detail,value:null,sources:[],manual:false};
    if(detail.value!==null) row.value=new Exact(row.value??0).plus(detail.value);
    row.sources.push(...detail.sources);row.manual ||= detail.manual;grouped.set(detail.id,row);
  }
  return [...grouped.values()].map(row=>({...row,value:row.value===null?null:Number(row.value.toString())}));
}

export async function getHistoricalReportDetails({pool,pnl,scopeId,month,channel=''}) {
  // Some source articles have blank cells in every month and only an annual
  // value. Use their stored identity to retain the blank line, never the YTD sum.
  const year=month.slice(0,4), start=`${month}-01`;
  const end=new Date(Date.UTC(Number(year),Number(month.slice(5)),1)).toISOString().slice(0,10);
  const metadata=(await pool.query(`SELECT m.id AS metric_id,m.name,h.external_key
    FROM qarzhy.historical_series s JOIN qarzhy.report_metrics m ON m.id=s.metric_id
    JOIN qarzhy.historical_values h ON h.series_id=s.id
    WHERE s.dataset_id=$1 AND s.scope_id=$2 AND s.report_family='pnl'
      AND h.period_kind='source_ytd' AND h.period_start=$3 AND h.external_key ~ '/O$'
      AND NOT EXISTS(SELECT 1 FROM qarzhy.historical_values v WHERE v.series_id=s.id
        AND v.period_kind='monthly' AND v.period_start=$4 AND v.period_end=$5)
    ORDER BY m.id`,[pnl.datasetId,scopeId,`${year}-01-01`,start,end])).rows;
  const column=String.fromCharCode(66+Number(month.slice(5)));
  const blanks=metadata.filter(row=>typeof row.external_key==='string' && /\/O$/.test(row.external_key)).map(row=>({...row,external_key:row.external_key.replace(/\/[A-Z]+$/,'/'+column),
    key:null,value:null,original:null,override_value:null}));
  return aggregateReportDetails([historicalReportDetails([...pnl.rows,...blanks],month,channel)]);
}
