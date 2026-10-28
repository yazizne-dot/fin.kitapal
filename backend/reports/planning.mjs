import { requirePermission } from '../auth/guards.mjs';
import { FinanceError, dateOnly, id, Exact } from '../finance/validation.mjs';
import { assertReportScope } from './access.mjs';
import { getCoverage } from './coverage.mjs';

const OPEX_LABEL = 'ИТОГО ОПЕРАЦИОННЫЕ РАСХОДЫ';

export async function getBudgetPeriod({ pool, principal, scopeId, start, end, pnl }) {
  requirePermission(principal, 'finance.read');
  const scope = await assertReportScope(pool, principal, scopeId);
  const from = dateOnly(start), to = dateOnly(end);
  if (from >= to || from.slice(8) !== '01') throw new FinanceError('Invalid budget period');
  if (pnl?.source === 'historical')
    return getHistoricalBudget({ pool, scope, from, datasetId: id(pnl.datasetId, 'dataset ID'), pnl });
  const coverage = await getCoverage({ pool, principal, family: 'budget', scopeId: scope, start: from, end: to });
  const warnings = [];
  if (!coverage.complete || coverage.intervals.length !== 1 || coverage.intervals[0].source_kind !== 'budget')
    warnings.push('Approved budget coverage is missing or ambiguous');
  if (warnings.length) return { rows: [], timeline: [], coverage, warnings };
  const version = (await pool.query(`SELECT id,name FROM qarzhy.budget_versions
    WHERE scope_id=$1 AND year=$2 AND status='approved'
    ORDER BY approved_at DESC,id DESC LIMIT 1`, [scope, Number(from.slice(0, 4))])).rows[0];
  if (!version) {
    warnings.push('Approved budget version is missing');
    return { rows: [], timeline: [], coverage, warnings };
  }
  const items = (await pool.query(`SELECT b.id,b.amount::text,m.code,m.name,m.id AS metric_id,
    b.article_id,a.name AS article_name,b.channel_id,c.name AS channel_name
    FROM qarzhy.budget_items b JOIN qarzhy.report_metrics m ON m.id=b.metric_id
    LEFT JOIN qarzhy.financial_articles a ON a.id=b.article_id
    LEFT JOIN qarzhy.sales_channels c ON c.id=b.channel_id
    WHERE b.budget_version_id=$1 AND b.month=$2 ORDER BY m.id,b.id`, [version.id, from])).rows;
  const rows = items.map(item => {
    const key = item.code.startsWith('live.pnl.') ? item.code.slice('live.pnl.'.length) : null;
    const mapped = !item.article_id && !item.channel_id && pnl?.source === 'events' &&
      key && Object.hasOwn(pnl.figures, key);
    const label = key === 'opex' && !item.article_id && !item.channel_id ? OPEX_LABEL :
      [item.name, item.article_name, item.channel_name].filter(Boolean).join(' · ');
    const source = { period: from.slice(0, 7), sheet: 'qarzhy.budget_items', cell: String(item.id),
      value: Number(item.amount) };
    const actualSource = { period: from.slice(0, 7), sheet: 'qarzhy.report_metrics',
      cell: String(item.metric_id), value: mapped && pnl.figures[key] !== null ? Number(pnl.figures[key]) : null };
    return { id: String(item.id), label, display: label, total: !item.article_id && !item.channel_id,
      plan: Number(item.amount), actual: mapped && pnl.figures[key] !== null ? Number(pnl.figures[key]) : null,
      referenceActual: mapped && pnl.figures[key] !== null ? Number(pnl.figures[key]) : null,
      sources: [{ period: from.slice(0, 7), plan: source, actual: actualSource }] };
  });
  if (items.some(item => item.article_id || item.channel_id))
    warnings.push('Article or channel budget actuals need an explicit matching rule');
  const opex = rows.find(row => row.label === OPEX_LABEL);
  return { rows, timeline: [{ month: from.slice(0, 7), plan: opex?.plan ?? null,
    actual: opex?.actual ?? null }], coverage, warnings, versionId: version.id };
}


// Historical workbook budgets are reported source values, not approved live
// budget versions. The source cell identifies plan vs actual unambiguously.
async function getHistoricalBudget({ pool, scope, from, datasetId, pnl }) {
  const year = from.slice(0, 4);
  const values = (await pool.query(`SELECT h.id,h.external_key,h.period_start::text,
    h.value::text AS original,o.value::text AS override_value,m.name,m.unit
    FROM qarzhy.historical_series s
    JOIN qarzhy.historical_values h ON h.series_id=s.id
    JOIN qarzhy.report_metrics m ON m.id=s.metric_id
    LEFT JOIN qarzhy.report_overrides o ON o.dataset_id=s.dataset_id AND o.scope_id=s.scope_id
      AND o.report_family='budget' AND o.period_start=h.period_start AND o.period_end=h.period_end
      AND o.period_kind=h.period_kind AND o.metric_id=s.metric_id
      AND o.article_id IS NOT DISTINCT FROM s.article_id AND o.channel_id IS NOT DISTINCT FROM s.channel_id
    WHERE s.dataset_id=$1 AND s.scope_id=$2 AND s.report_family='budget'
      AND h.period_kind='monthly' AND h.period_start >= $3 AND h.period_start < $4
    ORDER BY h.period_start,h.id`,
  [datasetId, scope, `${year}-01-01`, `${Number(year)+1}-01-01`])).rows;
  const months = new Map(), warnings = ['Historical imported budget; not an approved live budget version'];
  const number = value => value === null || value === undefined ? null : Number(value);
  for (const value of values) {
    const origin = /^pnl\/(Бюджет[^/]+)\/(\d+)\/([A-Z]+)$/.exec(value.external_key ?? '');
    if (!origin) continue;
    const [, sheet, rowId, column] = origin;
    const period = value.period_start.slice(0, 7);
    const ordinal = [...column].reduce((n, letter) => n*26 + letter.charCodeAt(0)-64, 0);
    const planColumn = 2 + (Number(period.slice(5))-1)*3;
    const field = ordinal === planColumn ? 'plan' : ordinal === planColumn+1 ? 'actual' : null;
    if (!field) continue; // Fulfilment is a ratio, never a third money amount.
    const label = value.name.slice(value.name.indexOf(':')+1).trim();
    if (label.includes('Бонус дистрибьюторам')) continue;
    const monthly = months.get(period) ?? new Map();
    const row = monthly.get(`${sheet}/${rowId}`) ?? { id: rowId, label,
      display: label.replaceAll('_', ' '), total: label.startsWith('ИТОГО') ||
        ['ПРОЧИЕ РАСХОДЫ', 'Тотал'].includes(label), plan: null, actual: null,
      referenceActual: null, sources: [], seen: new Set() };
    const amount = number(value.override_value ?? value.original);
    if (row.seen.has(field)) {
      row[field] = null;
      warnings.push(`Ambiguous historical budget ${period}: ${label} ${field}`);
    } else row[field] = amount;
    row.seen.add(field);
    const refs = row.sources[0] ?? { period,
      plan: { period, sheet, cell: '', value: null }, actual: { period, sheet, cell: '', value: null } };
    refs[field] = { period, sheet, cell: `${column}${rowId}`, value: amount };
    row.sources[0] = refs;
    monthly.set(`${sheet}/${rowId}`, row); months.set(period, monthly);
  }
  const rows = [...(months.get(from.slice(0, 7))?.values() ?? [])]
    .sort((a,b) => Number(a.id)-Number(b.id)).map(({seen, ...row}) => {
      const matching = (pnl.rows ?? []).filter(value => value.name.split('/').at(-1).trim() === row.label);
      if (matching.length === 1) row.referenceActual = number(matching[0].value);
      return row;
    });
  const timeline = Array.from({length: 12}, (_, index) => {
    const month = `${year}-${String(index+1).padStart(2,'0')}`;
    const total = [...(months.get(month)?.values() ?? [])].find(row => row.label === 'Тотал');
    return { month, plan: total?.plan ?? null, actual: total?.actual ?? null };
  });
  return { rows, timeline, warnings, source: 'historical' };
}


export function aggregateHistoricalBudgetRows(periods) {
  const rows = new Map();
  for (const period of periods) for (const item of period.rows) {
    const row = rows.get(item.id) ?? { ...item, plan: null, actual: null,
      referenceActual: null, sources: [] };
    for (const field of ['plan', 'actual', 'referenceActual'])
      if (item[field] !== null && item[field] !== undefined)
        row[field] = new Exact(row[field] ?? 0).plus(item[field]);
    row.sources.push(...item.sources); rows.set(item.id, row);
  }
  return [...rows.values()].map(row => ({ ...row,
    ...Object.fromEntries(['plan', 'actual', 'referenceActual'].map(field =>
      [field, row[field] === null ? null : Number(row[field].toFixed(2))])) }));
}
