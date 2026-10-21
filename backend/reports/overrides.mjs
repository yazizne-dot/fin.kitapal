import { requirePermission } from '../auth/guards.mjs';
import { FinanceError, dateOnly, id } from '../finance/validation.mjs';
import { audit } from '../finance/audit.mjs';
import { assertReportScope } from './access.mjs';
import { getPnlPeriod } from './pnl.mjs';

const FAMILIES = new Set(['pnl', 'balance', 'cashflow', 'sales', 'budget']);
const PERIOD_KINDS = new Set(['monthly', 'source_ytd', 'snapshot']);
const KEY_COLUMNS = '(dataset_id,report_family,scope_id,period_start,period_end,period_kind,metric_id,article_id,channel_id)';
const MATCH = `dataset_id=$1 AND report_family=$2 AND scope_id=$3 AND period_start=$4
  AND period_end=$5 AND period_kind=$6 AND metric_id=$7
  AND article_id IS NOT DISTINCT FROM $8 AND channel_id IS NOT DISTINCT FROM $9`;

function keyParts(key) {
  if (!FAMILIES.has(key.reportFamily)) throw new FinanceError('Invalid report family');
  if (!PERIOD_KINDS.has(key.periodKind)) throw new FinanceError('Invalid period kind');
  const start = dateOnly(key.periodStart), end = dateOnly(key.periodEnd);
  if (end <= start) throw new FinanceError('Invalid report period');
  return [id(key.datasetId, 'dataset ID'), key.reportFamily, id(key.scopeId, 'scope ID'),
    start, end, key.periodKind, id(key.metricId, 'metric ID'),
    key.articleId ? id(key.articleId, 'article ID') : null,
    key.channelId ? id(key.channelId, 'channel ID') : null];
}

function amount(value) {
  if (typeof value !== 'string' || !/^-?\d{1,24}(?:\.\d{1,12})?$/.test(value)) throw new FinanceError('Invalid report number');
  return value;
}

function reasonText(reason) {
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000) throw new FinanceError('Reason is required');
  return reason.trim();
}

async function currentRevision(client, revision) {
  const state = (await client.query('SELECT revision FROM qarzhy.financial_state WHERE singleton=true FOR UPDATE')).rows[0];
  if (!state) throw new FinanceError('Financial revision is missing', 503);
  if (!/^(0|[1-9]\d*)$/.test(String(revision)) || String(state.revision) !== String(revision))
    throw new FinanceError('Report revision conflict', 409);
  return (await client.query('UPDATE qarzhy.financial_state SET revision=revision+1 WHERE singleton=true RETURNING revision')).rows[0].revision;
}

async function sourceValue(client, parts, principal) {
  const dataset = (await client.query('SELECT kind FROM qarzhy.datasets WHERE id=$1', [parts[0]])).rows[0];
  if (dataset?.kind === 'live' && parts[1] === 'pnl' && parts[5] === 'monthly') {
    const metric = (await client.query('SELECT code FROM qarzhy.report_metrics WHERE id=$1', [parts[6]])).rows[0];
    if (metric?.code.startsWith('live.pnl.')) {
      const report = await getPnlPeriod({ pool: client, principal, scopeId: parts[2],
        start: parts[3], end: parts[4], source: 'events' });
      return report.baseFigures[metric.code.slice('live.pnl.'.length)] ?? null;
    }
  }
  const result = await client.query(`SELECT v.value::text,v.availability FROM qarzhy.historical_values v
    JOIN qarzhy.historical_series s ON s.id=v.series_id
    WHERE s.dataset_id=$1 AND s.report_family=$2 AND s.scope_id=$3
      AND v.period_start=$4 AND v.period_end=$5 AND v.period_kind=$6
      AND s.metric_id=$7 AND s.article_id IS NOT DISTINCT FROM $8
      AND s.channel_id IS NOT DISTINCT FROM $9`, parts);
  return result.rows[0]?.availability === 'reported' ? result.rows[0].value : null;
}

export async function setReportOverride({ client, principal, key, value, reason, revision }) {
  requirePermission(principal, 'finance.write');
  const parts = keyParts(key), nextValue = amount(value), note = reasonText(reason);
  await assertReportScope(client, principal, parts[2]);
  const nextRevision = await currentRevision(client, revision);
  const previous = (await client.query(`SELECT value::text,source_value::text FROM qarzhy.report_overrides
    WHERE ${MATCH} FOR UPDATE`, parts)).rows[0];
  const base = previous?.source_value ?? await sourceValue(client, parts, principal);
  const row = (await client.query(`INSERT INTO qarzhy.report_overrides
    (dataset_id,report_family,scope_id,period_start,period_end,period_kind,metric_id,article_id,channel_id,
     source_value,value,revision,updated_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT ${KEY_COLUMNS} DO UPDATE SET value=EXCLUDED.value,
      revision=EXCLUDED.revision,updated_by=EXCLUDED.updated_by,updated_at=now()
    RETURNING id,value::text,revision`, [...parts, base, nextValue, nextRevision, principal.id])).rows[0];
  await client.query(`INSERT INTO qarzhy.report_override_history
    (dataset_id,report_family,scope_id,period_start,period_end,period_kind,metric_id,article_id,channel_id,
     action,source_value,previous_value,next_value,revision,reason,author_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'set',$10,$11,$12,$13,$14,$15)`,
    [...parts, base, previous?.value ?? base, nextValue, nextRevision, note, principal.id]);
  await audit(client, principal, 'report_override_set', 'report_override', row.id,
    { before: { value: previous?.value ?? base }, after: { value: nextValue, revision: nextRevision }, reason: note });
  return { ...row, source_value: base, revision: Number(nextRevision) };
}

export async function resetReportOverride({ client, principal, key, reason, revision }) {
  requirePermission(principal, 'finance.write');
  const parts = keyParts(key), note = reasonText(reason);
  await assertReportScope(client, principal, parts[2]);
  const nextRevision = await currentRevision(client, revision);
  const previous = (await client.query(`DELETE FROM qarzhy.report_overrides WHERE ${MATCH}
    RETURNING id,value::text,source_value::text`, parts)).rows[0];
  if (!previous) throw new FinanceError('Report override not found', 404);
  await client.query(`INSERT INTO qarzhy.report_override_history
    (dataset_id,report_family,scope_id,period_start,period_end,period_kind,metric_id,article_id,channel_id,
     action,source_value,previous_value,next_value,revision,reason,author_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'reset',$10,$11,NULL,$12,$13,$14)`,
    [...parts, previous.source_value, previous.value, nextRevision, note, principal.id]);
  await audit(client, principal, 'report_override_reset', 'report_override', previous.id,
    { before: { value: previous.value }, after: { value: previous.source_value, revision: nextRevision }, reason: note });
  return { revision: Number(nextRevision), value: previous.source_value };
}

export async function listEditableFigures({ pool, principal, filters }) {
  requirePermission(principal, 'finance.read');
  const datasetId = id(filters.datasetId), scopeId = id(filters.scopeId);
  await assertReportScope(pool, principal, scopeId);
  const periodStart = dateOnly(filters.periodStart), periodEnd = dateOnly(filters.periodEnd);
  if (!FAMILIES.has(filters.reportFamily) || !PERIOD_KINDS.has(filters.periodKind)) throw new FinanceError('Invalid report filter');
  const dataset = (await pool.query('SELECT kind FROM qarzhy.datasets WHERE id=$1', [datasetId])).rows[0];
  if (dataset?.kind === 'live' && filters.reportFamily === 'pnl' && filters.periodKind === 'monthly') {
    const report = await getPnlPeriod({ pool, principal, scopeId, start: periodStart, end: periodEnd, source: 'events' });
    const metrics = (await pool.query("SELECT id,code,name FROM qarzhy.report_metrics WHERE code LIKE 'live.pnl.%' ORDER BY id")).rows;
    const overridden = new Set(report.rows.map(row => row.metric_id));
    const rows = metrics.map(metric => {
      const key = metric.code.slice('live.pnl.'.length);
      return { metric_id: metric.id, key, label: metric.name, original: report.baseFigures[key] ?? null,
        value: report.figures[key] ?? null, overridden: overridden.has(metric.id), article_id: null, channel_id: null };
    });
    const revision = (await pool.query('SELECT revision FROM qarzhy.financial_state WHERE singleton=true')).rows[0].revision;
    return { rows, revision: Number(revision) };
  }
  const rows = (await pool.query(`SELECT m.id AS metric_id,m.name AS label,h.value::text AS original,
    h.availability,coalesce(o.value,h.value)::text AS value,o.id IS NOT NULL AS overridden,
    s.article_id,s.channel_id
    FROM qarzhy.historical_series s JOIN qarzhy.historical_values h ON h.series_id=s.id
    JOIN qarzhy.report_metrics m ON m.id=s.metric_id
    LEFT JOIN qarzhy.report_overrides o ON o.dataset_id=s.dataset_id AND o.report_family=s.report_family
      AND o.scope_id=s.scope_id AND o.period_start=h.period_start AND o.period_end=h.period_end
      AND o.period_kind=h.period_kind AND o.metric_id=s.metric_id
      AND o.article_id IS NOT DISTINCT FROM s.article_id AND o.channel_id IS NOT DISTINCT FROM s.channel_id
    WHERE s.dataset_id=$1 AND s.scope_id=$2 AND s.report_family=$3 AND h.period_start=$4
      AND h.period_end=$5 AND h.period_kind=$6 ORDER BY m.name,m.id LIMIT 500`,
    [datasetId, scopeId, filters.reportFamily, periodStart, periodEnd, filters.periodKind])).rows;
  if (filters.reportFamily === 'pnl' && dataset?.kind === 'imported_finance') {
    const report = await getPnlPeriod({ pool, principal, scopeId, start: periodStart, end: periodEnd,
      periodKind: filters.periodKind, source: 'historical' });
    for (const row of rows) {
      const sourceRow = report.rows.find(source => String(source.metric_id) === String(row.metric_id) &&
        String(source.article_id || 0) === String(row.article_id || 0) &&
        String(source.channel_id || 0) === String(row.channel_id || 0));
      if (!row.overridden && ['gross', 'operatingProfit', 'profit', 'retained'].includes(sourceRow?.key) &&
          report.figures[sourceRow.key] !== null) {
        row.value = report.figures[sourceRow.key];
        row.recalculated = row.value !== row.original;
      }
    }
  }
  const revision = (await pool.query('SELECT revision FROM qarzhy.financial_state WHERE singleton=true')).rows[0].revision;
  return { rows, revision: Number(revision) };
}
