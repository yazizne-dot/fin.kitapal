import { requirePermission } from '../auth/guards.mjs';
import { FinanceError, dateOnly } from '../finance/validation.mjs';
import { assertReportScope } from './access.mjs';
import { getCoverage } from './coverage.mjs';

const OPEX_LABEL = 'ИТОГО ОПЕРАЦИОННЫЕ РАСХОДЫ';

export async function getBudgetPeriod({ pool, principal, scopeId, start, end, pnl }) {
  requirePermission(principal, 'finance.read');
  const scope = await assertReportScope(pool, principal, scopeId);
  const from = dateOnly(start), to = dateOnly(end);
  if (from >= to || from.slice(8) !== '01') throw new FinanceError('Invalid budget period');
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
