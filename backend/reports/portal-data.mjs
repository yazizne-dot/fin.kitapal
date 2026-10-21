import { requirePermission } from '../auth/guards.mjs';
import { FinanceError } from '../finance/validation.mjs';
import { getPnlPeriod } from './pnl.mjs';

const METRICS = ['revenue', 'cost', 'gross', 'opex', 'operatingProfit', 'otherExpense',
  'taxes', 'bonuses', 'otherIncome', 'profit', 'dividends', 'retained'];
const periodEnd = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1)).toISOString().slice(0, 10);
const display = value => value === null || value === undefined ? null : Number(value);

async function chosenMonth(pool, scopeId, organizationId) {
  const [history, live] = await Promise.all([
    pool.query(`SELECT max(h.period_start)::text AS latest FROM qarzhy.historical_values h
      JOIN qarzhy.historical_series s ON s.id=h.series_id
      WHERE s.scope_id=$1 AND s.report_family='pnl' AND h.period_kind='monthly'`, [scopeId]),
    pool.query(`SELECT max(occurred_on)::text AS latest FROM qarzhy.financial_events
      WHERE dataset_id=(SELECT id FROM qarzhy.datasets WHERE kind='live')
        AND ($1::bigint IS NULL OR organization_id=$1)`, [organizationId]),
  ]);
  return [history.rows[0].latest, live.rows[0].latest].filter(Boolean).sort().at(-1)?.slice(0, 7) ??
    new Date().toISOString().slice(0, 7);
}

export async function buildPortalFinanceData({ pool, principal, filters = {} }) {
  requirePermission(principal, 'finance.read');
  if (filters.channel || filters.org) throw new FinanceError('This report filter is not available yet', 503);
  if (filters.range && filters.range !== 'month') throw new FinanceError('This report range is not available yet', 503);
  if (filters.source && !['auto', 'workbook'].includes(filters.source))
    throw new FinanceError('This report source is not available yet', 503);
  const scope = (await pool.query(`SELECT id,organization_id FROM qarzhy.report_scopes
    WHERE (organization_id=$1 OR ($1::bigint IS NULL AND scope_type='consolidated'))`,
  [principal.organization_id ?? null])).rows[0];
  if (!scope) throw new FinanceError('Report scope is missing', 503);
  const month = filters.month || await chosenMonth(pool, scope.id, scope.organization_id);
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new FinanceError('Invalid report month');
  const start = `${month}-01`, end = periodEnd(month);
  const pnl = await getPnlPeriod({ pool, principal, scopeId: scope.id, start, end,
    source: filters.source === 'workbook' ? 'historical' : 'auto' });
  const report = Object.fromEntries(METRICS.map(key => [key, display(pnl.figures[key])]));
  const details = pnl.rows.filter(row => row.key && row.value !== undefined).map(row => {
    const source = { sheet: 'qarzhy.report_metrics', cell: String(row.metric_id), period: month,
      value: display(row.original), raw: row.original };
    return { id: String(row.metric_id), label: row.name, display: row.name, group: row.key,
      value: display(row.value), sources: [source], manual: row.override_value !== null };
  });
  const refs = {};
  for (const row of details) (refs[row.group] ??= []).push(...row.sources);
  const checks = [...pnl.warnings, 'Balance, sales, budget and cash-flow projections are still incomplete']
    .map((warning, index) => ({ id: `coverage-${index}`, period: month, kind: 'coverage',
      title: warning, reported: null, calculated: null, difference: null,
      sheet: 'qarzhy.coverage_rules', cell: '', detail: warning }));
  const actualAvailable = Boolean(pnl.source) && METRICS.some(key => report[key] !== null);
  const revision = (await pool.query('SELECT revision FROM qarzhy.financial_state WHERE singleton=true')).rows[0]?.revision;
  const overrideCount = (await pool.query(`SELECT count(*)::int AS n FROM qarzhy.report_overrides
    WHERE dataset_id=$1 AND scope_id=$2 AND report_family='pnl' AND period_start=$3 AND period_end=$4`,
  [pnl.datasetId, scope.id, start, end])).rows[0].n;
  return { source: 'workbook', datasetKind: pnl.source, demo: false,
    user: { id: Number(principal.id), name: principal.name, username: principal.username,
      role: principal.role, language: principal.language, active: Number(Boolean(principal.active)),
      must_change_password: Number(Boolean(principal.password_change_due)),
      org: principal.org ?? '', point: principal.point ?? '' },
    month, range: 'month', aggregation: 'PostgreSQL', channel: '', periods: [month], latest: month,
    actualThrough: actualAvailable ? month : null, actualAvailable, report, recalculated: null,
    previous: null, details, refs, channels: [], history: actualAvailable ? [{ month, ...report }] : [],
    budgetRows: [], budgetTimeline: [], checks, allCheckCount: checks.length,
    metadata: { file: 'PostgreSQL qarzhy', method: 'Relational finance reports', unit: 'KZT',
      limitations: checks.map(row => row.title) }, statements: { balance: null, cashflow: null },
    overrideCount, siteEntryCount: 0, financialRevision: Number(revision ?? 0) };
}
