import { requirePermission } from '../auth/guards.mjs';
import { Exact, FinanceError, dateOnly } from '../finance/validation.mjs';
import { assertReportScope } from './access.mjs';
import { getCoverage } from './coverage.mjs';

function total(rows, direction) {
  return rows.filter(row => row.direction === direction && !row.is_transfer)
    .reduce((amount, row) => amount.plus(row.amount), new Exact(0));
}

export async function getCashflowPeriod({ pool, principal, scopeId, start, end, source = 'auto' }) {
  requirePermission(principal, 'finance.read');
  const scope = await assertReportScope(pool, principal, scopeId);
  const organizationId = (await pool.query('SELECT organization_id FROM qarzhy.report_scopes WHERE id=$1', [scope])).rows[0].organization_id;
  const from = dateOnly(start), to = dateOnly(end);
  if (from >= to || !['auto', 'historical', 'movements', 'ledger'].includes(source))
    throw new FinanceError('Invalid cash flow filter');
  let selected = source, datasetId, coverage = null;
  if (source === 'auto') {
    coverage = await getCoverage({ pool, principal, family: 'cashflow', scopeId: scope, start: from, end: to });
    if (coverage.complete && coverage.intervals.length === 1 && coverage.intervals[0].start === from && coverage.intervals[0].end === to) {
      selected = coverage.intervals[0].source_kind;
      datasetId = coverage.intervals[0].dataset_id;
    } else selected = null;
  } else {
    const kind = { historical: 'imported_finance', movements: 'live', ledger: 'legacy_ledger' }[source];
    datasetId = (await pool.query('SELECT id FROM qarzhy.datasets WHERE kind=$1', [kind])).rows[0]?.id;
  }
  const warnings = [];
  let rows = [], totals = { inflow: null, outflow: null, net: null };
  if (!selected) warnings.push('Cash flow coverage is incomplete or splits the requested interval');
  if (selected === 'historical') {
    rows = (await pool.query(`SELECT m.id AS metric_id,m.name,h.value::text AS original,h.availability,
      coalesce(o.value,h.value)::text AS value
      FROM qarzhy.historical_series s JOIN qarzhy.historical_values h ON h.series_id=s.id
      JOIN qarzhy.report_metrics m ON m.id=s.metric_id
      LEFT JOIN qarzhy.report_overrides o ON o.dataset_id=s.dataset_id AND o.report_family='cashflow'
        AND o.scope_id=s.scope_id AND o.period_start=h.period_start AND o.period_end=h.period_end
        AND o.period_kind=h.period_kind AND o.metric_id=s.metric_id
        AND o.article_id IS NOT DISTINCT FROM s.article_id AND o.channel_id IS NOT DISTINCT FROM s.channel_id
      WHERE s.dataset_id=$1 AND s.scope_id=$2 AND s.report_family='cashflow'
        AND h.period_start=$3 AND h.period_end=$4 AND h.period_kind='monthly'
      ORDER BY m.id`, [datasetId, scope, from, to])).rows;
    warnings.push('Historical cash flow totals need an explicit metric mapping');
  } else if (selected === 'movements' || selected === 'ledger') {
    const datasetKind = (await pool.query('SELECT kind FROM qarzhy.datasets WHERE id=$1', [datasetId])).rows[0]?.kind;
    const live = datasetKind === 'live';
    rows = (await pool.query(`SELECT m.id,m.occurred_on::text AS occurred_on,m.direction,m.amount::text,m.organization_id,
      m.cash_account_id,m.article_id,a.name AS article_name,m.counterparty_id,m.note,
      (t.outgoing_id IS NOT NULL OR t.incoming_id IS NOT NULL) AS is_transfer
      FROM qarzhy.cash_movements m
      LEFT JOIN qarzhy.financial_articles a ON a.id=m.article_id
      LEFT JOIN qarzhy.cash_transfers t ON t.outgoing_id=m.id OR t.incoming_id=m.id
      WHERE m.dataset_id=$1 AND m.occurred_on >= $3 AND m.occurred_on < $4
        AND (($6::boolean AND ($2::bigint IS NULL OR m.organization_id=$2))
          OR (NOT $6::boolean AND m.scope_id=$5))
      ORDER BY m.occurred_on,m.id`, [datasetId, organizationId, from, to, scope, live])).rows;
    if (rows.some(row => !row.is_transfer && (!row.organization_id || !row.cash_account_id)))
      warnings.push('Unmapped organization or cash account in imported movements');
    const inflow = total(rows, 'in'), outflow = total(rows, 'out');
    totals = { inflow: inflow.toFixed(2), outflow: outflow.toFixed(2), net: inflow.minus(outflow).toFixed(2) };
  }
  return { source: selected, datasetId, scopeId: scope, start: from, end: to, rows, totals,
    complete: Boolean(selected) && warnings.length === 0, coverage, warnings };
}
