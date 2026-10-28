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

// Imported channels are dimensions of the source P&L rows. They need not have
// live sales_channels IDs; keep the original label as the historical filter ID.
export function historicalChannels(rows, month) {
  const grouped = new Map();
  for (const row of rows) {
    const path = row.name?.split(':').slice(1).join(':').trim().split('/');
    if (!path || path.length !== 2) continue;
    const section = path[0].trim(), label = path[1].trim();
    const key = section === 'ВЫРУЧКА ОТ РЕАЛИЗАЦИИ' ? 'revenue'
      : section === 'СЕБЕСТОИМОСТЬ РЕАЛИЗОВАННОЙ ПРОДУКЦИИ' ? 'cost' : null;
    if (!key || !label.startsWith('Продажи_')) continue;
    const channel = grouped.get(label) ?? { id: label, revenue: [], cost: [], sources: [] };
    channel[key].push(row.value === null || row.value === undefined ? null : new Exact(row.value));
    channel.sources.push({ sheet: 'qarzhy.report_metrics', cell: String(row.metric_id), period: month });
    grouped.set(label, channel);
  }
  const labels = { 'Продажи_по_дитрибьюторам': 'Дистрибьюторлар',
    'Продажи_интернет_операторы': 'Интернет операторлар', 'Продажи_оптовые': 'Көтерме сату',
    'Продажи_Каспи': 'Kaspi', 'Продажи_Сайт': 'Сайт', 'Продажи_Тендер': 'Тендер', 'Продажи_Экстра': 'Экстра' };
  return [...grouped.values()].filter(row => row.revenue.length).map(row => {
    const revenue = row.revenue.length === 1 ? row.revenue[0] : null;
    const cost = row.cost.length === 1 ? row.cost[0] : null;
    const label = row.id.startsWith('Продажи_по_магазинам_')
      ? row.id.slice('Продажи_по_магазинам_'.length).replaceAll('_', ' · ')
      : labels[row.id] ?? row.id.replaceAll('_', ' ');
    return { id: row.id, label, revenue: revenue === null ? null : value(revenue),
      cost: cost === null ? null : value(cost), gross: revenue === null || cost === null ? null : value(revenue.minus(cost)),
      previousRevenue: null, sources: row.sources };
  });
}
