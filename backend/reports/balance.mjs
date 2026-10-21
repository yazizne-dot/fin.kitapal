import { requirePermission } from '../auth/guards.mjs';
import { Exact, FinanceError, dateOnly } from '../finance/validation.mjs';
import { assertReportScope } from './access.mjs';
import { getCoverage } from './coverage.mjs';

const EMPTY = { cash: null, receivable: null, payable: null, inventory: null, otherAssets: null, assets: null, netAssets: null };
const day = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
const amount = value => new Exact(value).toFixed(2);

async function openingTotals(pool, snapshotId) {
  const [cash, debts, inventory, assets] = await Promise.all([
    pool.query('SELECT count(*)::int AS n,coalesce(sum(amount),0)::text AS value FROM qarzhy.cash_balances WHERE snapshot_id=$1', [snapshotId]),
    pool.query(`SELECT balance_kind,count(*)::int AS n,sum(amount)::text AS value
      FROM qarzhy.counterparty_balances WHERE snapshot_id=$1 GROUP BY balance_kind`, [snapshotId]),
    pool.query('SELECT count(*)::int AS n,coalesce(sum(total_value),0)::text AS value FROM qarzhy.inventory_positions WHERE snapshot_id=$1', [snapshotId]),
    pool.query('SELECT count(*)::int AS n,coalesce(sum(amount),0)::text AS value FROM qarzhy.asset_group_balances WHERE snapshot_id=$1', [snapshotId]),
  ]);
  const debt = Object.fromEntries(debts.rows.map(row => [row.balance_kind, row]));
  return {
    cash: cash.rows[0].n ? cash.rows[0].value : null,
    receivable: debt.receivable?.value ?? null,
    payable: debt.payable?.value ?? null,
    inventory: inventory.rows[0].n ? inventory.rows[0].value : null,
    otherAssets: assets.rows[0].n ? assets.rows[0].value : null,
  };
}

export async function getBalanceAt({ pool, principal, scopeId, asOf, source = 'auto' }) {
  requirePermission(principal, 'finance.read');
  const scope = await assertReportScope(pool, principal, scopeId);
  const organizationId = (await pool.query('SELECT organization_id FROM qarzhy.report_scopes WHERE id=$1', [scope])).rows[0].organization_id;
  const date = dateOnly(asOf);
  if (!['auto', 'historical', 'opening_and_movements'].includes(source)) throw new FinanceError('Invalid balance source');
  const warnings = [];
  const coverage = source === 'auto' ? await getCoverage({ pool, principal, family: 'balance', scopeId: scope,
    start: date, end: day(new Date(Date.parse(`${date}T00:00:00Z`) + 86400000)) }) : null;
  let rule = null;
  if (source === 'auto') {
    if (coverage.complete && coverage.intervals.length === 1) rule = coverage.intervals[0];
    else warnings.push('Balance coverage is missing or ambiguous for the requested date');
  } else {
    const kind = source === 'historical' ? 'imported_finance' : 'live';
    const dataset = (await pool.query('SELECT id FROM qarzhy.datasets WHERE kind=$1', [kind])).rows[0];
    if (dataset) rule = { dataset_id: dataset.id, source_kind: source };
    else warnings.push('Balance dataset is missing');
  }
  if (!rule) return { source: null, datasetId: null, scopeId: scope, asOf: date, totals: { ...EMPTY },
    rows: [], complete: false, coverage, warnings };

  if (rule.source_kind === 'historical') {
    const rows = (await pool.query(`SELECT m.id AS metric_id,m.code,m.name,h.value::text AS original,
      coalesce(o.value,h.value)::text AS value,h.availability
      FROM qarzhy.historical_series s JOIN qarzhy.historical_values h ON h.series_id=s.id
      JOIN qarzhy.report_metrics m ON m.id=s.metric_id
      LEFT JOIN qarzhy.report_overrides o ON o.dataset_id=s.dataset_id AND o.report_family='balance'
        AND o.scope_id=s.scope_id AND o.period_start=h.period_start AND o.period_end=h.period_end
        AND o.period_kind=h.period_kind AND o.metric_id=s.metric_id
        AND o.article_id IS NOT DISTINCT FROM s.article_id AND o.channel_id IS NOT DISTINCT FROM s.channel_id
      WHERE s.dataset_id=$1 AND s.scope_id=$2 AND s.report_family='balance'
        AND h.period_kind='snapshot' AND h.period_start=$3
      ORDER BY m.id`, [rule.dataset_id, scope, date])).rows;
    warnings.push(rows.length ? 'Historical balance totals require explicit metric mapping' : 'Historical balance snapshot is missing');
    return { source: 'historical', datasetId: rule.dataset_id, scopeId: scope, asOf: date,
      totals: { ...EMPTY }, rows, complete: false, coverage, warnings };
  }

  if (rule.source_kind !== 'opening_and_movements') throw new FinanceError('Invalid balance coverage source');
  const snapshot = rule.opening_snapshot_id
    ? (await pool.query(`SELECT id,as_of_date,status FROM qarzhy.balance_snapshots
      WHERE id=$1 AND dataset_id=$2 AND scope_id=$3`, [rule.opening_snapshot_id, rule.dataset_id, scope])).rows[0]
    : (await pool.query(`SELECT id,as_of_date,status FROM qarzhy.balance_snapshots
      WHERE dataset_id=$1 AND scope_id=$2 AND as_of_date<=$3 ORDER BY as_of_date DESC,id DESC LIMIT 1`,
    [rule.dataset_id, scope, date])).rows[0];
  if (!snapshot || snapshot.status !== 'verified' || day(snapshot.as_of_date) > date) {
    warnings.push('Verified opening balance snapshot is required');
    return { source: 'opening_and_movements', datasetId: rule.dataset_id, scopeId: scope, asOf: date,
      totals: { ...EMPTY }, rows: [], complete: false, coverage, warnings };
  }
  const opening = await openingTotals(pool, snapshot.id);
  const cashMovements = (await pool.query(`SELECT m.id,m.direction,m.amount::text,m.cash_account_id,
      m.organization_id,a.organization_id AS account_organization_id
    FROM qarzhy.cash_movements m LEFT JOIN qarzhy.cash_accounts a ON a.id=m.cash_account_id
    WHERE m.dataset_id=$1 AND ($2::bigint IS NULL OR m.organization_id=$2)
      AND m.occurred_on >= $3 AND m.occurred_on < $4`,
  [rule.dataset_id, organizationId, day(snapshot.as_of_date), date])).rows;
  const cashMapped = cashMovements.every(row => row.cash_account_id && row.organization_id &&
    String(row.organization_id) === String(row.account_organization_id));
  if (!cashMapped) warnings.push('Unmapped cash account or organization prevents a cash balance');
  const totals = { ...opening };
  if (opening.cash !== null && cashMapped) {
    let value = new Exact(opening.cash);
    for (const row of cashMovements) value = row.direction === 'in' ? value.plus(row.amount) : value.minus(row.amount);
    totals.cash = amount(value);
  } else totals.cash = null;
  for (const key of ['cash', 'receivable', 'payable', 'inventory', 'otherAssets'])
    if (totals[key] === null) warnings.push(`Opening ${key} balance is missing`);
  // Opening non-cash amounts are shown as source facts, but are not current balances until
  // document settlements, inventory changes and asset movements are reconciled.
  if (day(snapshot.as_of_date) !== date) {
    for (const key of ['receivable', 'payable', 'inventory', 'otherAssets']) totals[key] = null;
    warnings.push('Non-cash balances require document, inventory and asset reconciliation');
  }
  if (['cash', 'receivable', 'inventory', 'otherAssets'].every(key => totals[key] !== null))
    totals.assets = amount(new Exact(totals.cash).plus(totals.receivable).plus(totals.inventory).plus(totals.otherAssets));
  else totals.assets = null;
  totals.netAssets = totals.assets !== null && totals.payable !== null
    ? amount(new Exact(totals.assets).minus(totals.payable)) : null;
  return { source: 'opening_and_movements', datasetId: rule.dataset_id, scopeId: scope, asOf: date,
    openingSnapshotId: snapshot.id, opening, totals, rows: cashMovements, complete: warnings.length === 0,
    coverage, warnings };
}
