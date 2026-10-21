import { requirePermission, AccessError } from '../auth/guards.mjs';
import { FinanceError, dateOnly, id } from '../finance/validation.mjs';
import { audit } from '../finance/audit.mjs';
import { assertReportScope } from './access.mjs';

const SOURCES = {
  pnl: ['historical', 'events'],
  cashflow: ['historical', 'movements'],
  balance: ['historical', 'opening_and_movements'],
  sales: ['historical', 'events'],
  budget: ['historical', 'budget'],
};

function day(value) { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value); }

export async function getCoverage({ pool, principal, family, scopeId, metricId = null, start, end }) {
  requirePermission(principal, 'finance.read');
  if (!SOURCES[family]) throw new FinanceError('Invalid report family');
  const from = dateOnly(start), to = dateOnly(end);
  if (from >= to) throw new FinanceError('Invalid report interval');
  const scope = await assertReportScope(pool, principal, scopeId);
  const rows = (await pool.query(`SELECT c.id,c.dataset_id,d.kind AS dataset_kind,c.scope_id,c.report_family,
    c.metric_id,c.starts_on::text AS starts_on,c.ends_on::text AS ends_on,c.source_kind,c.opening_snapshot_id
    FROM qarzhy.coverage_rules c JOIN qarzhy.datasets d ON d.id=c.dataset_id
    WHERE c.report_family=$1 AND c.scope_id=$2
      AND (c.metric_id=$3 OR c.metric_id IS NULL)
      AND c.starts_on<$5 AND c.ends_on>$4
    ORDER BY c.starts_on,c.id`, [family, scope, metricId ? id(metricId) : null, from, to])).rows;
  const intervals = [], gaps = [];
  let cursor = from;
  for (const row of rows) {
    const intervalStart = day(row.starts_on) < from ? from : day(row.starts_on);
    const intervalEnd = day(row.ends_on) > to ? to : day(row.ends_on);
    if (intervalStart > cursor) gaps.push({ start: cursor, end: intervalStart });
    if (intervalEnd > cursor) {
      intervals.push({ ...row, start: intervalStart, end: intervalEnd });
      cursor = intervalEnd;
    }
  }
  if (cursor < to) gaps.push({ start: cursor, end: to });
  return { intervals, gaps, complete: gaps.length === 0 };
}

export async function saveCoverage({ client, principal, input }) {
  requirePermission(principal, 'finance.write');
  if (!SOURCES[input.family]?.includes(input.sourceKind)) throw new FinanceError('Invalid coverage source for report family');
  const datasetId = id(input.datasetId, 'dataset ID'), scopeId = id(input.scopeId, 'scope ID');
  const start = dateOnly(input.start), end = dateOnly(input.end);
  if (end <= start) throw new FinanceError('Invalid coverage interval');
  const dataset = (await client.query('SELECT kind FROM qarzhy.datasets WHERE id=$1', [datasetId])).rows[0];
  if (!dataset) throw new FinanceError('Dataset not found', 404);
  if (input.sourceKind === 'historical' && dataset.kind !== 'imported_finance')
    throw new FinanceError('Historical coverage must use imported finance data');
  const importedCashMovements = input.family === 'cashflow' && input.sourceKind === 'movements' &&
    dataset.kind === 'legacy_ledger';
  if (input.sourceKind !== 'historical' && dataset.kind !== 'live' && !importedCashMovements)
    throw new FinanceError('Movement or event coverage has an incompatible dataset');
  const scope = (await client.query('SELECT organization_id FROM qarzhy.report_scopes WHERE id=$1', [scopeId])).rows[0];
  if (!scope) throw new FinanceError('Report scope not found', 404);
  if (principal.organization_id && String(principal.organization_id) !== String(scope.organization_id)) throw new AccessError('Forbidden scope');
  let openingSnapshotId = null;
  if (input.sourceKind === 'opening_and_movements') {
    openingSnapshotId = id(input.openingSnapshotId, 'opening snapshot ID');
    const snapshot = (await client.query(`SELECT status,as_of_date::text AS as_of_date,dataset_id,scope_id FROM qarzhy.balance_snapshots
      WHERE id=$1`, [openingSnapshotId])).rows[0];
    if (!snapshot || snapshot.status !== 'verified' || day(snapshot.as_of_date) !== start ||
        String(snapshot.dataset_id) !== datasetId || String(snapshot.scope_id) !== scopeId)
      throw new FinanceError('Coverage requires a verified opening snapshot for its exact start date');
  } else if (input.openingSnapshotId) throw new FinanceError('Opening snapshot is only valid for balance cutover');
  const metricId = input.metricId ? id(input.metricId, 'metric ID') : null;
  const overlap = (await client.query(`SELECT id FROM qarzhy.coverage_rules
    WHERE scope_id=$1 AND report_family=$2
      AND (metric_id=$3 OR metric_id IS NULL OR $3::bigint IS NULL)
      AND daterange(starts_on,ends_on,'[)') && daterange($4::date,$5::date,'[)') LIMIT 1`,
    [scopeId, input.family, metricId, start, end])).rows[0];
  if (overlap) throw new FinanceError('Coverage interval overlaps another rule', 409);
  const row = (await client.query(`INSERT INTO qarzhy.coverage_rules
    (dataset_id,scope_id,report_family,metric_id,starts_on,ends_on,source_kind,opening_snapshot_id,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [datasetId, scopeId, input.family, metricId, start, end, input.sourceKind, openingSnapshotId, principal.id])).rows[0];
  await audit(client, principal, 'coverage_create', 'coverage_rule', row.id,
    { after: { family: input.family, start, end, source: input.sourceKind } });
  return row;
}

export async function verifyOpeningSnapshot({ client, principal, id: snapshotInput, version }) {
  requirePermission(principal, 'finance.write');
  const snapshot = (await client.query('SELECT * FROM qarzhy.balance_snapshots WHERE id=$1 FOR UPDATE',
    [id(snapshotInput, 'snapshot ID')])).rows[0];
  if (!snapshot) throw new FinanceError('Opening snapshot not found', 404);
  if (snapshot.status !== 'draft') throw new FinanceError('Only draft snapshots can be verified', 409);
  if (Number(snapshot.version) !== Number(version)) throw new FinanceError('Snapshot version conflict', 409);
  const scope = (await client.query('SELECT organization_id FROM qarzhy.report_scopes WHERE id=$1', [snapshot.scope_id])).rows[0];
  if (principal.organization_id && String(principal.organization_id) !== String(scope?.organization_id)) throw new AccessError('Forbidden scope');
  const counts = (await client.query(`SELECT
    (SELECT count(*) FROM qarzhy.cash_balances WHERE snapshot_id=$1) +
    (SELECT count(*) FROM qarzhy.counterparty_balances WHERE snapshot_id=$1) +
    (SELECT count(*) FROM qarzhy.asset_group_balances WHERE snapshot_id=$1) AS n`, [snapshot.id])).rows[0];
  if (Number(counts.n) === 0) throw new FinanceError('Opening snapshot has no verified balances');
  const row = (await client.query(`UPDATE qarzhy.balance_snapshots SET status='verified',version=version+1,
    updated_at=now() WHERE id=$1 RETURNING *`, [snapshot.id])).rows[0];
  await audit(client, principal, 'opening_snapshot_verify', 'balance_snapshot', snapshot.id,
    { before: { status: 'draft' }, after: { status: 'verified' } });
  return row;
}
