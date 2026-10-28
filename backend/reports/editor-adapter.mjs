import { requirePermission } from '../auth/guards.mjs';
import { FinanceError, id } from '../finance/validation.mjs';
import { assertReportScope } from './access.mjs';
import { listEditableFigures, setReportOverride, resetReportOverride } from './overrides.mjs';

const monthName = row => row.period_kind === 'source_ytd'
  ? `${(row.period_start instanceof Date ? row.period_start.toISOString() : String(row.period_start)).slice(0,4)}-YTD`
  : row.month || (row.period_start instanceof Date ? row.period_start.toISOString() : String(row.period_start)).slice(0,7);
export function chooseEditorSheet(months, explicit) {
  return explicit || monthName(months.find(row => row.period_kind !== 'source_ytd' && row.has_values) ?? months[0] ?? {month:new Date().toISOString().slice(0,7)});
}
export function presentEditorRow(row) {
  const origin = /^pnl\/(P&L_\d{4})\/(\d+)\/([A-Z]+)$/.exec(row.external_key ?? '');
  return {cell:`${row.metric_id}:${row.article_id || 0}:${row.channel_id || 0}`,
    displayCell: origin ? `${origin[1]}!${origin[3]}${origin[2]}` : String(row.metric_id),
    label: origin ? row.label.split('/').at(-1).replace(/^P&L_\d{4}:\s*/, '').replaceAll('_',' ') : row.label,
    original:row.original,value:row.value,availability:row.availability ?? 'reported',
    overridden:row.overridden,recalculated:row.recalculated ?? false,formula:null};
}

function parseBook(book, defaultScopeId) {
  if (book === 'pnl') return { kind: 'history', scopeId: defaultScopeId };
  const match = /^pnl-(history|live)-([1-9]\d*)$/.exec(String(book));
  if (!match) throw new FinanceError('Invalid report book');
  return { kind: match[1], scopeId: match[2] };
}

function period(sheet) {
  if (/^\d{4}-YTD$/.test(String(sheet))) {
    const year = Number(sheet.slice(0, 4));
    return { start: `${year}-01-01`, end: `${year + 1}-01-01`, periodKind: 'source_ytd' };
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(sheet))) throw new FinanceError('Invalid report month');
  const [year, month] = sheet.split('-').map(Number);
  const start = `${sheet}-01`;
  const end = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  return { start, end, periodKind: 'monthly' };
}

async function context(pool, principal, book) {
  const scopes = (await pool.query(`SELECT s.id,s.scope_type,s.organization_id,o.name AS organization_name
    FROM qarzhy.report_scopes s LEFT JOIN qarzhy.organizations o ON o.id=s.organization_id
    WHERE $1::bigint IS NULL OR s.organization_id=$1 ORDER BY s.id`, [principal.organization_id ?? null])).rows;
  const defaultScope = scopes.find(row => row.scope_type === 'consolidated') ?? scopes[0];
  if (!defaultScope) throw new FinanceError('No accessible report scope', 404);
  const parsed = parseBook(book || 'pnl', defaultScope.id);
  const scopeId = await assertReportScope(pool, principal, parsed.scopeId);
  const datasetKind = parsed.kind === 'live' ? 'live' : 'imported_finance';
  const dataset = (await pool.query('SELECT id FROM qarzhy.datasets WHERE kind=$1', [datasetKind])).rows[0];
  if (!dataset) throw new FinanceError('Report dataset not found', 404);
  return { ...parsed, scopeId, datasetId: dataset.id, scopes };
}

export async function listEditor({ pool, principal, filters }) {
  requirePermission(principal, 'finance.read');
  const selected = await context(pool, principal, filters.book);
  const books = selected.scopes.flatMap(scope => [
    { id: `pnl-history-${scope.id}`, file: `ОПиУ · история · ${scope.organization_name || 'Все организации'}` },
    ...(scope.scope_type === 'organization' ? [{ id: `pnl-live-${scope.id}`, file: `ОПиУ · новые операции · ${scope.organization_name}` }] : []),
  ]);
  const book = `pnl-${selected.kind}-${selected.scopeId}`;
  const months = selected.kind === 'history'
    ? (await pool.query(`SELECT h.period_start::text,h.period_kind,bool_or(h.value<>0 OR o.id IS NOT NULL) AS has_values
      FROM qarzhy.historical_values h JOIN qarzhy.historical_series s ON s.id=h.series_id
      LEFT JOIN qarzhy.report_overrides o ON o.dataset_id=s.dataset_id AND o.scope_id=s.scope_id
        AND o.report_family=s.report_family AND o.metric_id=s.metric_id AND o.period_start=h.period_start
        AND o.period_end=h.period_end AND o.period_kind=h.period_kind
        AND o.article_id IS NOT DISTINCT FROM s.article_id AND o.channel_id IS NOT DISTINCT FROM s.channel_id
      WHERE s.dataset_id=$1 AND s.scope_id=$2 AND s.report_family='pnl'
        AND h.period_kind IN ('monthly','source_ytd')
      GROUP BY h.period_start,h.period_kind ORDER BY h.period_start DESC,h.period_kind LIMIT 120`, [selected.datasetId, selected.scopeId])).rows
    : (await pool.query(`SELECT DISTINCT to_char(occurred_on,'YYYY-MM') AS month
      FROM qarzhy.financial_events WHERE dataset_id=$1 AND scope_id=$2
      ORDER BY month DESC LIMIT 120`, [selected.datasetId, selected.scopeId])).rows;
  const sheets = months.map(monthName);
  const sheet = chooseEditorSheet(months, filters.sheet);
  const { start, end, periodKind } = period(sheet);
  const figures = await listEditableFigures({ pool, principal, filters: {
    datasetId: selected.datasetId, scopeId: selected.scopeId, reportFamily: 'pnl',
    periodStart: start, periodEnd: end, periodKind,
  } });
  const query = String(filters.q || '').trim().toLocaleLowerCase();
  const offset = Number(filters.offset || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new FinanceError('Invalid offset');
  const ordered = [...figures.rows].sort((a,b) => {
    const left = /^pnl\/[^/]+\/(\d+)\//.exec(a.external_key ?? '');
    const right = /^pnl\/[^/]+\/(\d+)\//.exec(b.external_key ?? '');
    return left && right ? Number(left[1])-Number(right[1]) : 0;
  });
  const matches = ordered.filter(row => !query || row.label.toLocaleLowerCase().includes(query) || String(row.metric_id).includes(query) || presentEditorRow(row).displayCell.toLocaleLowerCase().includes(query));
  const rows = matches.slice(offset, offset + 60).map(presentEditorRow);
  return { books, book, sheets, sheet, rows, total: matches.length, offset, revision: figures.revision };
}

export async function editEditorCell({ client, principal, input }) {
  requirePermission(principal, 'finance.write');
  const selected = await context(client, principal, input.book);
  const { start, end, periodKind } = period(input.sheet);
  const match = /^([1-9]\d*):(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(String(input.cell));
  if (!match) throw new FinanceError('Invalid report metric');
  const key = { datasetId: selected.datasetId, scopeId: selected.scopeId, reportFamily: 'pnl',
    periodStart: start, periodEnd: end, periodKind, metricId: id(match[1]),
    articleId: match[2] === '0' ? null : id(match[2]), channelId: match[3] === '0' ? null : id(match[3]) };
  const figures = await listEditableFigures({ pool: client, principal, filters: key });
  if (!figures.rows.some(row => String(row.metric_id) === key.metricId &&
      String(row.article_id || 0) === match[2] && String(row.channel_id || 0) === match[3]))
    throw new FinanceError('Report metric is not available for this period', 404);
  const result = input.reset
    ? await resetReportOverride({ client, principal, key, reason: input.reason, revision: input.revision })
    : await setReportOverride({ client, principal, key, value: String(input.value),
      reason: input.reason, revision: input.revision });
  return { ok: true, revision: result.revision };
}
