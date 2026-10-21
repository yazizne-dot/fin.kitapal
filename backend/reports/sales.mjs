import { Exact } from '../finance/validation.mjs';
import { requirePermission } from '../auth/guards.mjs';
import { dateOnly } from '../finance/validation.mjs';

const sum = values => values.reduce((total, value) => total.plus(value), new Exact(0));
const value = amount => Number(amount.toFixed(2));

export async function getLiveChannelSales({ pool, principal, organizationId, datasetId, start, end }) {
  requirePermission(principal, 'finance.read');
  const from = dateOnly(start), to = dateOnly(end);
  const events = (await pool.query(`SELECT e.id,e.event_kind,e.amount::text,e.cost_amount::text,
      e.channel_id,c.name AS channel_name,d.kind AS document_kind
    FROM qarzhy.financial_events e
    LEFT JOIN qarzhy.sales_channels c ON c.id=e.channel_id
    LEFT JOIN qarzhy.documents d ON d.id=e.document_id AND d.dataset_id=e.dataset_id
    WHERE e.dataset_id=$1 AND ($2::bigint IS NULL OR e.organization_id=$2)
      AND e.occurred_on >= $3 AND e.occurred_on < $4
      AND e.channel_id IS NOT NULL
    ORDER BY e.id`, [datasetId, organizationId, from, to])).rows;
  const channels = new Map();
  for (const event of events) {
    if (!['revenue', 'cost'].includes(event.event_kind) &&
        !(event.event_kind === 'return' && event.document_kind === 'sale_return')) continue;
    const key = String(event.channel_id);
    const row = channels.get(key) ?? { id: key, label: event.channel_name,
      revenueParts: [], costParts: [], sources: [] };
    if (event.event_kind === 'revenue' || event.event_kind === 'return') {
      row.revenueParts.push(new Exact(event.amount));
      if (event.cost_amount !== null) row.costParts.push(new Exact(event.cost_amount));
    } else row.costParts.push(new Exact(event.amount));
    row.sources.push({ sheet: 'qarzhy.financial_events', cell: String(event.id), period: from.slice(0, 7) });
    channels.set(key, row);
  }
  return [...channels.values()].map(row => {
    const revenue = sum(row.revenueParts), cost = sum(row.costParts);
    return { id: row.id, label: row.label, revenue: value(revenue), cost: value(cost),
      gross: value(revenue.minus(cost)), previousRevenue: null, sources: row.sources };
  });
}
