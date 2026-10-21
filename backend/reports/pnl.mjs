import { Exact } from '../finance/validation.mjs';
import { requirePermission, AccessError } from '../auth/guards.mjs';
import { FinanceError, dateOnly, id } from '../finance/validation.mjs';
import { getCoverage } from './coverage.mjs';

const INPUTS = ['revenue', 'cost', 'opex', 'otherExpense', 'bonuses', 'otherIncome', 'taxes', 'dividends'];
const DERIVED = ['gross', 'operatingProfit', 'profit', 'retained'];
const EVENT_KEYS = { revenue: 'revenue', cost: 'cost', opex: 'opex', other_expense: 'otherExpense',
  bonus: 'bonuses', other_income: 'otherIncome', tax: 'taxes', dividend: 'dividends' };
const LABEL_KEYS = new Map([
  ['ТОТАЛ ВЫРУЧКА', 'revenue'], ['ИТОГО СЕБЕСТОИМОСТЬ', 'cost'],
  ['ВАЛОВЫЙ ДОХОД', 'gross'], ['ИТОГО АДМИНИСТРАТИВНЫЕ', 'opex'],
  ['ОПЕРАЦИОННАЯ ПРИБЫЛЬ', 'operatingProfit'], ['ПРОЧИЕ РАСХОДЫ', 'otherExpense'],
  ['НАЛОГИ', 'taxes'], ['РЕТРО-БОНУСЫ ДИСТРАМ', 'bonuses'],
  ['ПРОЧИЕ ДОХОДЫ ОТ НЕОСНОВНОЙ ДЕЯТЕЛЬНОСТИ', 'otherIncome'],
  ['ЧИСТАЯ ПРИБЫЛЬ', 'profit'], ['ИТОГО НЕРАСПРЕДЕЛЁННАЯ', 'retained'],
]);

function metricKey(row) {
  if (row.code.startsWith('live.pnl.')) return row.code.slice('live.pnl.'.length);
  if (INPUTS.includes(row.code) || DERIVED.includes(row.code)) return row.code;
  const label = row.name.split(':').at(-1).split('/').at(-1).trim().toUpperCase();
  for (const [prefix, key] of LABEL_KEYS) if (label === prefix || label.startsWith(`${prefix} `)) return key;
  return null;
}

function sum(values) { return values.reduce((total, value) => total.plus(value), new Exact(0)).toFixed(2); }

function exact(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid report number');
  return new Exact(value);
}

function show(value) { return value === null ? null : value.toFixed(2); }

export function calculatePnl(base, overrides = {}) {
  const values = {};
  const reconciliation = { gross: null, operatingProfit: null, profit: null, retained: null };
  for (const key of INPUTS)
    values[key] = exact(Object.hasOwn(overrides, key) ? overrides[key] : base[key]);

  function derive(key, calculated) {
    const replacement = Object.hasOwn(overrides, key) ? exact(overrides[key]) : null;
    if (replacement !== null) {
      reconciliation[key] = calculated === null ? null : show(replacement.minus(calculated));
      values[key] = replacement;
    } else values[key] = calculated;
  }
  derive('gross', values.revenue === null || values.cost === null ? null : values.revenue.minus(values.cost));
  derive('operatingProfit', values.gross === null || values.opex === null ? null : values.gross.minus(values.opex));
  derive('profit', [values.operatingProfit, values.otherExpense, values.bonuses, values.otherIncome, values.taxes].some(value => value === null)
    ? null : values.operatingProfit.minus(values.otherExpense).minus(values.bonuses).plus(values.otherIncome).minus(values.taxes));
  derive('retained', values.profit === null || values.dividends === null ? null : values.profit.minus(values.dividends));
  return { ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, show(value)])), reconciliation };
}

export async function getPnlPeriod({ pool, principal, scopeId, start, end, periodKind = 'monthly', source = 'auto' }) {
  requirePermission(principal, 'finance.read');
  const scope = id(scopeId, 'scope ID'), from = dateOnly(start), to = dateOnly(end);
  if (from >= to || !['monthly', 'source_ytd'].includes(periodKind) || !['auto', 'historical', 'events'].includes(source))
    throw new FinanceError('Invalid P&L filter');
  const scopeRow = (await pool.query('SELECT organization_id FROM qarzhy.report_scopes WHERE id=$1', [scope])).rows[0];
  if (!scopeRow) throw new FinanceError('Report scope not found', 404);
  if (principal.organization_id && String(principal.organization_id) !== String(scopeRow.organization_id))
    throw new AccessError('Forbidden scope');

  let selected = source, datasetId = null, coverage = null;
  if (source === 'auto') {
    coverage = await getCoverage({ pool, principal, family: 'pnl', scopeId: scope, start: from, end: to });
    if (coverage.complete && coverage.intervals.length === 1 && coverage.intervals[0].start === from && coverage.intervals[0].end === to) {
      selected = coverage.intervals[0].source_kind;
      datasetId = coverage.intervals[0].dataset_id;
    } else selected = null;
  }
  if (source !== 'auto') {
    const kind = source === 'historical' ? 'imported_finance' : 'live';
    datasetId = (await pool.query('SELECT id FROM qarzhy.datasets WHERE kind=$1', [kind])).rows[0]?.id;
  }
  const warnings = [];
  if (!selected) warnings.push('P&L coverage is incomplete or splits the requested interval');
  const base = Object.fromEntries(INPUTS.map(key => [key, null]));
  const overrides = {};
  let rows = [];

  if (selected === 'historical') {
    rows = (await pool.query(`SELECT m.id AS metric_id,m.code,m.name,h.value::text AS original,
      h.availability,o.value::text AS override_value,s.article_id,s.channel_id
      FROM qarzhy.historical_series s JOIN qarzhy.historical_values h ON h.series_id=s.id
      JOIN qarzhy.report_metrics m ON m.id=s.metric_id
      LEFT JOIN qarzhy.report_overrides o ON o.dataset_id=s.dataset_id AND o.report_family='pnl'
        AND o.scope_id=s.scope_id AND o.period_start=h.period_start AND o.period_end=h.period_end
        AND o.period_kind=h.period_kind AND o.metric_id=s.metric_id
        AND o.article_id IS NOT DISTINCT FROM s.article_id AND o.channel_id IS NOT DISTINCT FROM s.channel_id
      WHERE s.dataset_id=$1 AND s.scope_id=$2 AND s.report_family='pnl'
        AND h.period_start=$3 AND h.period_end=$4 AND h.period_kind=$5
      ORDER BY m.id`, [datasetId, scope, from, to, periodKind])).rows;
    const recognized = new Set();
    for (const row of rows) {
      row.key = metricKey(row);
      row.value = row.override_value ?? row.original;
      if (!row.key || row.article_id || row.channel_id) continue;
      if (recognized.has(row.key)) {
        warnings.push(`Ambiguous historical metric: ${row.key}`);
        if (INPUTS.includes(row.key)) base[row.key] = null;
        else delete overrides[row.key];
        continue;
      }
      recognized.add(row.key);
      if (INPUTS.includes(row.key)) base[row.key] = row.value;
      else if (row.override_value !== null) overrides[row.key] = row.override_value;
    }
    const missing = INPUTS.filter(key => base[key] === null);
    if (missing.length) warnings.push(`Missing historical P&L figures: ${missing.join(', ')}`);
  } else if (selected === 'events') {
    if (periodKind !== 'monthly') throw new FinanceError('Live events cannot supply source YTD');
    const events = (await pool.query(`SELECT event_kind,amount::text FROM qarzhy.financial_events
      WHERE dataset_id=$1 AND ($2::bigint IS NULL OR organization_id=$2)
        AND occurred_on >= $3 AND occurred_on < $4`,
    [datasetId, scopeRow.organization_id, from, to])).rows;
    for (const key of INPUTS) base[key] = sum(events.filter(row => EVENT_KEYS[row.event_kind] === key).map(row => row.amount));
    rows = (await pool.query(`SELECT m.id AS metric_id,m.code,m.name,o.value::text AS override_value
      FROM qarzhy.report_overrides o JOIN qarzhy.report_metrics m ON m.id=o.metric_id
      WHERE o.dataset_id=$1 AND o.scope_id=$2 AND o.report_family='pnl'
        AND o.period_start=$3 AND o.period_end=$4 AND o.period_kind=$5
        AND o.article_id IS NULL AND o.channel_id IS NULL`, [datasetId, scope, from, to, periodKind])).rows;
    for (const row of rows) {
      row.key = metricKey(row);
      if (row.key) overrides[row.key] = row.override_value;
    }
  }
  const figures = calculatePnl(base, overrides);
  const baseFigures = calculatePnl(base);
  return { source: selected, datasetId, scopeId: scope, start: from, end: to, periodKind,
    complete: Boolean(selected) && warnings.length === 0, coverage, figures, baseFigures, rows, warnings };
}
