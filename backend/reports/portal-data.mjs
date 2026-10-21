import { requirePermission } from '../auth/guards.mjs';
import { FinanceError } from '../finance/validation.mjs';
import { getPnlPeriod } from './pnl.mjs';
import { getCashflowPeriod } from './cashflow.mjs';
import { getBalanceAt } from './balance.mjs';
import { getBudgetPeriod } from './planning.mjs';

const METRICS = ['revenue', 'cost', 'gross', 'opex', 'operatingProfit', 'otherExpense',
  'taxes', 'bonuses', 'otherIncome', 'profit', 'dividends', 'retained'];
const periodEnd = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1)).toISOString().slice(0, 10);
const display = value => value === null || value === undefined ? null : Number(value);

function presentBalance(balance) {
  if (!balance.openingSnapshotId) return null;
  const source = { sheet: 'qarzhy.balance_snapshots', cell: String(balance.openingSnapshotId),
    period: balance.asOf };
  const labels = [
    ['assets', 'Активтер'], ['cash', 'Ақша қаражаты'], ['receivables', 'Дебиторлық берешек'],
    ['inventory', 'Тауар қалдығы'], ['fixed', 'Өзге активтер'], ['liabilities', 'Міндеттемелер'],
    ['payables', 'Кредиторлық берешек'], ['equity', 'Меншікті капитал'],
  ];
  const values = { assets: balance.totals.assets, cash: balance.totals.cash,
    receivables: balance.totals.receivable, inventory: balance.totals.inventory,
    fixed: balance.totals.otherAssets, liabilities: null, payables: balance.totals.payable,
    equity: null };
  return { date: balance.asOf, asOfLabel: balance.asOf,
    metadata: { file: 'PostgreSQL qarzhy', limitations: balance.warnings },
    rows: labels.map(([id, label]) => ({ id, label, value: display(values[id]), source })),
    cashAccounts: [], suppliers: [], assetGroups: [], inventory: [], checks: [], capitalIsResidual: false };
}

function presentCashflow(cashflow, balance, month) {
  if (cashflow.totals.net === null) return null;
  const rows = cashflow.rows.map(row => ({ id: row.id, date: row.occurred_on,
    period: row.occurred_on.slice(0, 7),
    article: `${row.article_name || 'Бап көрсетілмеген'}${row.is_transfer ? ' · Ішкі аударым' : ''}`,
    inflow: row.direction === 'in' ? Number(row.amount) : 0,
    outflow: row.direction === 'out' ? Number(row.amount) : 0,
    note: row.note, cashReplenishment: row.is_transfer,
    source: { sheet: 'qarzhy.cash_movements', cell: String(row.id), period: row.occurred_on } }));
  const sum = (items, key) => items.reduce((value, row) => value + row[key], 0);
  const allInflow = sum(rows, 'inflow'), allOutflow = sum(rows, 'outflow');
  const transferRows = rows.filter(row => row.cashReplenishment);
  const transferInflow = sum(transferRows, 'inflow'), transferOutflow = sum(transferRows, 'outflow');
  const grouped = new Map(), daily = new Map();
  for (const row of rows) {
    const articleKey = `${row.article}:${row.cashReplenishment}`;
    const article = grouped.get(articleKey) ?? { article: row.article, inflow: 0, outflow: 0,
      count: 0, cashReplenishment: row.cashReplenishment };
    article.inflow += row.inflow; article.outflow += row.outflow; article.count++;
    grouped.set(articleKey, article);
    const date = daily.get(row.date) ?? { date: row.date, inflow: 0, outflow: 0 };
    date.inflow += row.inflow; date.outflow += row.outflow;
    daily.set(row.date, date);
  }
  const closing = display(balance.totals.cash);
  return { month, range: 'month', available: true,
    metadata: { file: 'PostgreSQL qarzhy', limitations: cashflow.warnings }, periods: [month],
    totals: { inflow: allInflow, outflow: allOutflow, net: allInflow - allOutflow },
    business: { inflow: Number(cashflow.totals.inflow), outflow: Number(cashflow.totals.outflow),
      net: Number(cashflow.totals.net) },
    replenishments: { inflow: transferInflow, outflow: transferOutflow,
      net: transferInflow - transferOutflow },
    articles: [...grouped.values()], rows, daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    summary: null, opening: display(balance.opening?.cash), closing,
    closingDate: closing === null ? null : balance.asOf, periodMismatchCount: 0 };
}

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
  const [pnl, balance, cashflow] = await Promise.all([
    getPnlPeriod({ pool, principal, scopeId: scope.id, start, end,
      source: filters.source === 'workbook' ? 'historical' : 'auto' }),
    getBalanceAt({ pool, principal, scopeId: scope.id, asOf: end }),
    getCashflowPeriod({ pool, principal, scopeId: scope.id, start, end }),
  ]);
  const report = Object.fromEntries(METRICS.map(key => [key, display(pnl.figures[key])]));
  const budget = await getBudgetPeriod({ pool, principal, scopeId: scope.id, start, end, pnl });
  const details = pnl.rows.filter(row => row.key && row.value !== undefined).map(row => {
    const source = { sheet: 'qarzhy.report_metrics', cell: String(row.metric_id), period: month,
      value: display(row.original), raw: row.original };
    return { id: String(row.metric_id), label: row.name, display: row.name, group: row.key,
      value: display(row.value), sources: [source], manual: row.override_value !== null };
  });
  const refs = {};
  for (const row of details) (refs[row.group] ??= []).push(...row.sources);
  const checks = [...pnl.warnings, ...balance.warnings, ...cashflow.warnings,
    ...budget.warnings, 'Sales projection is still incomplete']
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
    budgetRows: budget.rows, budgetTimeline: budget.timeline, checks, allCheckCount: checks.length,
    metadata: { file: 'PostgreSQL qarzhy', method: 'Relational finance reports', unit: 'KZT',
      limitations: checks.map(row => row.title) }, statements: { balance: presentBalance(balance),
      cashflow: presentCashflow(cashflow, balance, month) },
    overrideCount, siteEntryCount: 0, financialRevision: Number(revision ?? 0) };
}
