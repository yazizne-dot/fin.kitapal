import { requirePermission } from '../auth/guards.mjs';
import { Exact, FinanceError } from '../finance/validation.mjs';
import { getPnlPeriod } from './pnl.mjs';
import { getCashflowPeriod } from './cashflow.mjs';
import { getBalanceAt } from './balance.mjs';
import { getBudgetPeriod } from './planning.mjs';
import { getLiveChannelSales } from './sales.mjs';

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
      WHERE s.scope_id=$1 AND s.report_family='pnl' AND h.period_kind='monthly'
        AND (h.value<>0 OR EXISTS (
          SELECT 1 FROM qarzhy.coverage_rules c
          WHERE c.scope_id=s.scope_id AND c.dataset_id=s.dataset_id
            AND c.report_family='pnl' AND c.source_kind='historical'
            AND c.starts_on<=h.period_start AND c.ends_on>=h.period_end
        ))`, [scopeId]),
    pool.query(`SELECT max(occurred_on)::text AS latest FROM qarzhy.financial_events
      WHERE dataset_id=(SELECT id FROM qarzhy.datasets WHERE kind='live')
        AND ($1::bigint IS NULL OR organization_id=$1)`, [organizationId]),
  ]);
  return [history.rows[0].latest, live.rows[0].latest].filter(Boolean).sort().at(-1)?.slice(0, 7) ??
    new Date().toISOString().slice(0, 7);
}

async function availableMonths(pool, scopeId, organizationId, selected) {
  const rows = (await pool.query(`SELECT DISTINCT month,kind FROM (
    SELECT to_char(h.period_start,'YYYY-MM') AS month,'actual' AS kind
      FROM qarzhy.historical_values h JOIN qarzhy.historical_series s ON s.id=h.series_id
      WHERE s.scope_id=$1 AND s.report_family='pnl' AND h.period_kind='monthly'
        AND (h.value<>0 OR EXISTS (
          SELECT 1 FROM qarzhy.coverage_rules c
          WHERE c.scope_id=s.scope_id AND c.dataset_id=s.dataset_id
            AND c.report_family='pnl' AND c.source_kind='historical'
            AND c.starts_on<=h.period_start AND c.ends_on>=h.period_end
        ))
    UNION ALL
    SELECT to_char(e.occurred_on,'YYYY-MM'),'actual'
      FROM qarzhy.financial_events e JOIN qarzhy.datasets d ON d.id=e.dataset_id
      WHERE d.kind='live' AND ($2::bigint IS NULL OR e.organization_id=$2)
    UNION ALL
    SELECT to_char(b.month,'YYYY-MM'),'plan'
      FROM qarzhy.budget_items b JOIN qarzhy.budget_versions v ON v.id=b.budget_version_id
      WHERE v.scope_id=$1 AND v.status='approved'
  ) months ORDER BY month DESC LIMIT 240`, [scopeId, organizationId])).rows;
  const periods = [...new Set([selected, ...rows.map(row => row.month)])].sort();
  const latestActual = rows.filter(row => row.kind === 'actual').map(row => row.month).sort().at(-1);
  return { periods, latestActual: latestActual ?? selected };
}

async function comparablePnl({ pool, principal, scopeId, month, source }) {
  const period = await getPnlPeriod({ pool, principal, scopeId,
    start: `${month}-01`, end: periodEnd(month), source });
  if (!period.source || period.figures.revenue === null || period.figures.cost === null) return null;
  return Object.fromEntries(METRICS.map(key => [key, display(period.figures[key])]));
}

function yearMonths(year, through) {
  return Array.from({ length: Number(through.slice(5)) }, (_, index) =>
    `${year}-${String(index + 1).padStart(2, '0')}`);
}

function sumMonthly(periods, key) {
  if (!periods.length || periods.some(period => !period.source || period.figures[key] === null)) return null;
  return Number(periods.reduce((sum, period) => sum.plus(period.figures[key]), new Exact(0)).toFixed(2));
}

async function buildYearToDate({ pool, principal, filters, scope, month, available, source }) {
  if (filters.channel) throw new FinanceError('YTD channel breakdown is not available yet', 503);
  const latest = available.latestActual;
  const through = latest.slice(0, 4) === month.slice(0, 4) && latest < month ? latest : month;
  const months = through.slice(0, 4) === month.slice(0, 4) ? yearMonths(month.slice(0, 4), through) : [];
  const priorYear = String(Number(month.slice(0, 4)) - 1).padStart(4, '0');
  const [base, current, prior] = await Promise.all([
    buildPortalFinanceData({ pool, principal, filters: { ...filters, range: 'month', channel: '' } }),
    Promise.all(months.map(value => getPnlPeriod({ pool, principal, scopeId: scope.id,
      start: `${value}-01`, end: periodEnd(value), source }))),
    Promise.all(months.map(value => getPnlPeriod({ pool, principal, scopeId: scope.id,
      start: `${priorYear}${value.slice(4)}-01`, end: periodEnd(`${priorYear}${value.slice(4)}`), source }))),
  ]);
  const complete = current.length > 0 && current.every(period => period.source &&
    period.figures.revenue !== null && period.figures.cost !== null);
  const report = Object.fromEntries(METRICS.map(key => [key, complete ? sumMonthly(current, key) : null]));
  const previous = prior.length && prior.every(period => period.source)
    ? Object.fromEntries(METRICS.map(key => [key, sumMonthly(prior, key)])) : null;
  const history = current.flatMap((period, index) => period.source && period.figures.revenue !== null
    ? [{ month: months[index], ...Object.fromEntries(METRICS.map(key => [key, display(period.figures[key])])) }] : []);
  const details = current.flatMap((period, index) => period.rows
    .filter(row => row.key && row.value !== undefined)
    .map(row => ({ id: `${months[index]}-${row.metric_id}`, label: row.name, display: row.name,
      group: row.key, value: display(row.value), manual: row.override_value !== null,
      sources: [{ sheet: 'qarzhy.report_metrics', cell: String(row.metric_id),
        period: months[index], value: display(row.original), raw: row.original }] })));
  const refs = {};
  for (const row of details) (refs[row.group] ??= []).push(...row.sources);
  const warnings = current.flatMap((period, index) => period.warnings.map(warning =>
    `${months[index]}: ${warning}`));
  if (!complete) warnings.push('YTD P&L requires covered monthly figures from January through the selected month');
  warnings.push('YTD budget and channel totals require separately verified coverage');
  const checks = warnings.map((warning, index) => ({
    id: `ytd-${index}`, period: month, kind: 'coverage', title: warning,
    reported: null, calculated: null, difference: null,
    sheet: 'qarzhy.coverage_rules', cell: '', detail: warning,
  }));
  let statements = { balance: null, cashflow: null };
  if (months.length) {
    const end = periodEnd(through);
    const [balance, cashflow] = await Promise.all([
      getBalanceAt({ pool, principal, scopeId: scope.id, asOf: end }),
      getCashflowPeriod({ pool, principal, scopeId: scope.id,
        start: `${month.slice(0, 4)}-01-01`, end }),
    ]);
    const shown = presentCashflow(cashflow, balance, month);
    statements = { balance: presentBalance(balance), cashflow: shown
      ? { ...shown, range: 'ytd', periods: months } : null };
    for (const warning of [...balance.warnings, ...cashflow.warnings]) checks.push({
      id: `ytd-${checks.length}`, period: month, kind: 'coverage', title: warning,
      reported: null, calculated: null, difference: null,
      sheet: 'qarzhy.coverage_rules', cell: '', detail: warning,
    });
  }
  const overrideCount = months.length ? (await pool.query(`SELECT count(*)::int AS n FROM qarzhy.report_overrides
    WHERE scope_id=$1 AND report_family='pnl' AND period_kind='monthly'
      AND period_start >= $2 AND period_end <= $3`,
  [scope.id, `${month.slice(0, 4)}-01-01`, periodEnd(through)])).rows[0].n : 0;
  return { ...base, range: 'ytd', aggregation: 'monthly-sum', actualThrough: complete ? through : null,
    actualAvailable: complete, report, previous, history, details, refs,
    budgetRows: [], budgetTimeline: [], channels: [], checks, allCheckCount: checks.length,
    statements, overrideCount,
    metadata: { ...base.metadata, method: 'Sum of covered monthly PostgreSQL P&L figures',
      limitations: checks.map(row => row.title) } };
}

export async function buildPortalFinanceData({ pool, principal, filters = {} }) {
  requirePermission(principal, 'finance.read');
  if (filters.org) throw new FinanceError('This report filter is not available yet', 503);
  if (filters.range && !['month', 'ytd'].includes(filters.range)) throw new FinanceError('Invalid report range');
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
  const available = await availableMonths(pool, scope.id, scope.organization_id, month);
  const pnlSource = filters.source === 'workbook' ? 'historical' : 'auto';
  if (filters.range === 'ytd') return buildYearToDate({ pool, principal, filters,
    scope, month, available, source: pnlSource });
  const [pnl, balance, cashflow] = await Promise.all([
    getPnlPeriod({ pool, principal, scopeId: scope.id, start, end,
      source: pnlSource }),
    getBalanceAt({ pool, principal, scopeId: scope.id, asOf: end }),
    getCashflowPeriod({ pool, principal, scopeId: scope.id, start, end }),
  ]);
  const report = Object.fromEntries(METRICS.map(key => [key, display(pnl.figures[key])]));
  const budget = await getBudgetPeriod({ pool, principal, scopeId: scope.id, start, end, pnl });
  const channels = pnl.source === 'events' ? await getLiveChannelSales({ pool, principal,
    organizationId: scope.organization_id, datasetId: pnl.datasetId, start, end }) : [];
  const channelId = filters.channel || '';
  const selectedChannel = channelId ? channels.find(row => row.id === channelId) : null;
  if (channelId && !selectedChannel) throw new FinanceError('Sales channel not available in this report', 404);
  if (selectedChannel) {
    for (const key of METRICS) report[key] = null;
    report.revenue = selectedChannel.revenue;
    report.cost = selectedChannel.cost;
    report.gross = selectedChannel.gross;
  }
  const historyMonths = available.periods.filter(value => value.slice(0, 4) === month.slice(0, 4) &&
    value <= month).slice(-12);
  const pastMonths = historyMonths.filter(value => value !== month);
  const pastReports = await Promise.all(pastMonths.map(value => comparablePnl({ pool, principal,
    scopeId: scope.id, month: value, source: pnlSource })));
  const history = pastMonths.flatMap((value, index) => pastReports[index]
    ? [{ month: value, ...pastReports[index] }] : []);
  if (pnl.source && report.revenue !== null && report.cost !== null) history.push({ month, ...report });
  const priorMonth = `${String(Number(month.slice(0, 4)) - 1).padStart(4, '0')}${month.slice(4)}`;
  const previous = selectedChannel ? null : await comparablePnl({ pool, principal,
    scopeId: scope.id, month: priorMonth, source: pnlSource });
  const details = pnl.rows.filter(row => row.key && row.value !== undefined).map(row => {
    const source = { sheet: 'qarzhy.report_metrics', cell: String(row.metric_id), period: month,
      value: display(row.original), raw: row.original };
    return { id: String(row.metric_id), label: row.name, display: row.name, group: row.key,
      value: display(row.value), sources: [source], manual: row.override_value !== null };
  });
  const refs = {};
  for (const row of details) (refs[row.group] ??= []).push(...row.sources);
  const checks = [...pnl.warnings, ...balance.warnings, ...cashflow.warnings,
    ...(selectedChannel ? [] : budget.warnings),
    ...(pnl.source === 'events' ? [] : ['Sales channels need live event coverage']),
    ...(selectedChannel ? ['Channel overhead is not allocated; channel profit is unavailable'] : []),
    ...(channels.length && channels.some(row => row.previousRevenue === null)
      ? ['Previous-year channel revenue is unavailable without matching coverage'] : [])]
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
    month, range: 'month', aggregation: 'PostgreSQL', channel: channelId,
    periods: available.periods, latest: available.latestActual,
    actualThrough: actualAvailable ? month : null, actualAvailable, report, recalculated: null,
    previous, details: selectedChannel ? [] : details, refs: selectedChannel ? {} : refs,
    channels, history: selectedChannel ? (actualAvailable ? [{ month, ...report }] : []) : history,
    budgetRows: selectedChannel ? [] : budget.rows,
    budgetTimeline: selectedChannel ? [] : budget.timeline, checks, allCheckCount: checks.length,
    metadata: { file: 'PostgreSQL qarzhy', method: 'Relational finance reports', unit: 'KZT',
      limitations: checks.map(row => row.title) }, statements: { balance: selectedChannel ? null : presentBalance(balance),
      cashflow: selectedChannel ? null : presentCashflow(cashflow, balance, month) },
    overrideCount: selectedChannel ? 0 : overrideCount,
    siteEntryCount: 0, financialRevision: Number(revision ?? 0) };
}
