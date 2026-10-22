import { requirePermission, AccessError } from '../auth/guards.mjs';
import { FinanceError, Exact } from '../finance/validation.mjs';
import { userJson } from '../http/account-routes.mjs';
import { ledger, debts, kinds } from '../../server/finance/accounting.mjs';

const EVENT_KINDS = Object.freeze({ revenue: 'sale', return: 'return', purchase: 'purchase',
  opex: 'expense', depreciation: 'depreciation', tax: 'tax', capital: 'capital', loan: 'loan',
  loan_repayment: 'loan_payment', asset: 'asset' });
const KEY = /^sqlite\/operation\/([1-9]\d*)\/(event|cash)$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function classifyLegacyOperation({ eventKind, cashDirection, settlementKinds = [], articleEventKinds = [], articleName }) {
  if (eventKind) {
    const kind = EVENT_KINDS[eventKind];
    if (!kind) throw new FinanceError(`Unclassified legacy event kind: ${eventKind}`, 503);
    const expected = { capital: 'in', loan: 'in', loan_payment: 'out', asset: 'out' }[kind];
    if ((expected && cashDirection !== expected) || (!expected && cashDirection))
      throw new FinanceError(`Ambiguous legacy event/cash combination: ${eventKind}`, 503);
    return kind;
  }
  if (settlementKinds.length === 1 && settlementKinds[0] === 'sale' && cashDirection === 'in') return 'receipt';
  if (settlementKinds.length === 1 && settlementKinds[0] === 'purchase' && cashDirection === 'out') return 'supplier_payment';
  if (settlementKinds.length || articleEventKinds.length > 1)
    throw new FinanceError('Ambiguous legacy cash classification', 503);
  if (cashDirection === 'out' && articleEventKinds.length === 1) {
    if (articleEventKinds[0] === 'opex') return 'expense_payment';
    if (articleEventKinds[0] === 'tax') return 'tax_payment';
  }
  // The confirmed SQLite import gave tax payments their own article, with no tax accrual on that article.
  if (cashDirection === 'out' && articleName === 'Салық төлемі') return 'tax_payment';
  throw new FinanceError('Unclassified legacy cash movement', 503);
}

function safeLegacyNumber(value, label) {
  const amount = Number(value ?? 0);
  if (!Number.isSafeInteger(amount) || String(value ?? '0').replace(/\.0+$/, '') !== String(amount))
    throw new FinanceError(`Legacy ${label} is not an exact whole-number amount`, 503);
  return amount;
}

function safeDisplayMoney(value) {
  const cents = new Exact(value).times(100);
  if (!cents.isInteger() || !cents.abs().lte(Number.MAX_SAFE_INTEGER))
    throw new FinanceError('Plan amount exceeds browser precision', 503);
  return cents.toNumber() / 100;
}

function noteDetails(note) {
  if (!note) return {};
  try { const data = JSON.parse(note); return data && typeof data === 'object' ? data : {}; }
  catch { throw new FinanceError('Invalid imported cash provenance', 503); }
}

function originalId(key, part) {
  const match = KEY.exec(key ?? '');
  if (!match || match[2] !== part) throw new FinanceError('Invalid imported operation key', 503);
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id)) throw new FinanceError('Imported operation ID exceeds safe range', 503);
  return id;
}

function selectedMonth(value, rows) {
  const month = value || rows.at(-1)?.date.slice(0, 7) || new Date().toISOString().slice(0, 7);
  if (!MONTH.test(month)) throw new FinanceError('Invalid report month');
  return month;
}

const endOfMonth = month => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).toISOString().slice(0, 10);
const priorYear = month => `${String(+month.slice(0, 4) - 1).padStart(4, '0')}${month.slice(4)}`;

export async function buildLegacyLedgerData({ pool, principal, filters = {} }) {
  requirePermission(principal, 'finance.read');
  if (filters.range && filters.range !== 'month') throw new FinanceError('Ledger supports monthly range only');
  if (filters.channel) throw new FinanceError('Ledger has no channel filter');
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const data = await readLegacyLedgerData({ client, principal, filters });
    await client.query('COMMIT');
    return data;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function readLegacyLedgerData({ client, principal, filters }) {
  const dataset = (await client.query("SELECT id FROM qarzhy.datasets WHERE kind='legacy_ledger'")).rows[0];
  if (!dataset) throw new FinanceError('Legacy ledger dataset is missing', 503);
  const orgs = (await client.query(`SELECT DISTINCT o.id,o.name FROM qarzhy.organizations o
    WHERE ($1::bigint IS NULL OR o.id=$1) AND (EXISTS (
      SELECT 1 FROM qarzhy.financial_events e WHERE e.dataset_id=$2 AND e.organization_id=o.id
        AND e.external_key ~ '^sqlite/operation/[1-9][0-9]*/event$') OR EXISTS (
      SELECT 1 FROM qarzhy.cash_movements c WHERE c.dataset_id=$2 AND c.organization_id=o.id
        AND c.external_key ~ '^sqlite/operation/[1-9][0-9]*/cash$') OR EXISTS (
      SELECT 1 FROM qarzhy.payment_plans p WHERE p.organization_id=o.id) OR EXISTS (
      SELECT 1 FROM qarzhy.budget_versions v JOIN qarzhy.report_scopes s ON s.id=v.scope_id
      WHERE s.organization_id=o.id AND v.name='Legacy ledger budget ' || v.year::text) OR EXISTS (
      SELECT 1 FROM qarzhy.portal_operations p WHERE p.organization_id=o.id))
    ORDER BY o.name`,
  [principal.organization_id ?? null, dataset.id])).rows;
  const matches = filters.org ? orgs.filter(row => row.name === filters.org) : [];
  if (matches.length > 1) throw new FinanceError('Ambiguous organization name', 409);
  const selected = matches[0];
  if (filters.org && !selected) throw new AccessError('Organization not available', 403);
  const organizationId = selected?.id ?? principal.organization_id ?? null;
  const events = await client.query(`SELECT e.external_key,to_char(e.occurred_on,'YYYY-MM-DD') date,e.event_kind,
      e.amount::text amount,e.cost_amount::text cost,e.organization_id,o.name org,
      a.name article,cp.name counterparty,d.number document,to_char(d.due_date,'YYYY-MM-DD') due,
      l.name point FROM qarzhy.financial_events e
      JOIN qarzhy.organizations o ON o.id=e.organization_id
      LEFT JOIN qarzhy.financial_articles a ON a.id=e.article_id
      LEFT JOIN qarzhy.counterparties cp ON cp.id=e.counterparty_id
      LEFT JOIN qarzhy.documents d ON d.id=e.document_id
      LEFT JOIN qarzhy.locations l ON l.id=d.location_id
      WHERE e.dataset_id=$1 AND e.active=true AND ($2::bigint IS NULL OR e.organization_id=$2)
        AND e.external_key LIKE 'sqlite/operation/%/event' ORDER BY e.occurred_on,e.id`,
    [dataset.id, organizationId]);
  const movements = await client.query(`SELECT c.external_key,to_char(c.occurred_on,'YYYY-MM-DD') date,c.direction,
      c.amount::text amount,c.organization_id,o.name org,c.article_id,a.name article,
      cp.name counterparty,c.note,s.kinds settlement_kinds FROM qarzhy.cash_movements c
      JOIN qarzhy.organizations o ON o.id=c.organization_id
      LEFT JOIN qarzhy.financial_articles a ON a.id=c.article_id
      LEFT JOIN qarzhy.counterparties cp ON cp.id=c.counterparty_id
      LEFT JOIN LATERAL (SELECT array_agg(DISTINCT d.kind) kinds
        FROM qarzhy.document_settlements ds JOIN qarzhy.documents d ON d.id=ds.document_id
        WHERE ds.cash_movement_id=c.id) s ON true
      WHERE c.dataset_id=$1 AND ($2::bigint IS NULL OR c.organization_id=$2)
        AND c.external_key LIKE 'sqlite/operation/%/cash' ORDER BY c.occurred_on,c.id`,
    [dataset.id, organizationId]);
  const articleKinds = await client.query(`SELECT article_id,array_agg(DISTINCT event_kind) kinds FROM qarzhy.financial_events
      WHERE dataset_id=$1 AND event_kind IN ('opex','tax') AND active=true
        AND external_key LIKE 'sqlite/operation/%/event' GROUP BY article_id`, [dataset.id]);
  const profiles = new Map(articleKinds.rows.map(row => [String(row.article_id), row.kinds]));
  const grouped = new Map();
  for (const event of events.rows) {
    const id = originalId(event.external_key, 'event');
    if (grouped.has(id)) throw new FinanceError('Duplicate imported operation ID', 503);
    grouped.set(id, { event });
  }
  for (const cash of movements.rows) {
    const id = originalId(cash.external_key, 'cash');
    const pair = grouped.get(id) ?? {};
    if (pair.cash) throw new FinanceError('Duplicate imported cash operation ID', 503);
    pair.cash = cash;
    grouped.set(id, pair);
  }
  const imported = [...grouped].map(([id, { event, cash }]) => {
    if (event && cash && (event.date !== cash.date || String(event.organization_id) !== String(cash.organization_id)))
      throw new FinanceError('Imported event and cash movement disagree', 503);
    const kind = classifyLegacyOperation({ eventKind: event?.event_kind,
      cashDirection: cash?.direction, settlementKinds: cash?.settlement_kinds ?? [],
      articleEventKinds: profiles.get(String(cash?.article_id)) ?? [], articleName: cash?.article });
    const raw = event ?? cash;
    const note = noteDetails(cash?.note);
    const amount = safeLegacyNumber(event?.amount ?? cash?.amount, 'amount');
    if (cash && event && amount !== safeLegacyNumber(cash.amount, 'cash amount'))
      throw new FinanceError('Imported event and cash amount disagree', 503);
    return { id, external_id: `sqlite-operation-${id}`, source: note.source || 'demo',
      date: raw.date, org: raw.org, point: event?.point || '',
      counterparty: event?.counterparty || cash?.counterparty || '',
      document: event?.document || note.document || `sqlite/operation/${id}`,
      kind, amount: Math.abs(amount), cost: safeLegacyNumber(event?.cost, 'cost'),
      due: event?.due || '', article: event?.article || cash?.article || '' };
  });
  const portalRows = (await client.query(`SELECT p.id,p.source,p.external_id,
    to_char(p.occurred_on,'YYYY-MM-DD') date,o.name org,p.point,p.counterparty_label,
    p.document_label,p.kind,p.amount::text amount,p.cost::text cost,
    to_char(p.due_date,'YYYY-MM-DD') due,p.article_label
    FROM qarzhy.portal_operations p JOIN qarzhy.organizations o ON o.id=p.organization_id
    LEFT JOIN qarzhy.financial_events e ON e.id=p.financial_event_id
    LEFT JOIN qarzhy.documents d ON d.id=p.document_id
    WHERE ($1::bigint IS NULL OR p.organization_id=$1)
      AND (p.financial_event_id IS NULL OR e.active=true)
      AND (p.document_id IS NULL OR d.status='posted')
      AND NOT EXISTS (SELECT 1 FROM qarzhy.financial_events r WHERE r.reverses_event_id=e.id)
    ORDER BY p.occurred_on,p.id`, [organizationId])).rows;
  const all = [...imported, ...portalRows.map(row => {
    const id = Number(row.id);
    if (!Number.isSafeInteger(id)) throw new FinanceError('Portal operation ID exceeds safe range', 503);
    return { id: -id, external_id: row.external_id, source: row.source,
      date: row.date, org: row.org, point: row.point, counterparty: row.counterparty_label,
      document: row.document_label, kind: row.kind, amount: safeLegacyNumber(row.amount, 'amount'),
      cost: safeLegacyNumber(row.cost, 'cost'), due: row.due || '', article: row.article_label };
  })].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const month = selectedMonth(filters.month, all), start = `${month}-01`, end = endOfMonth(month);
  const current = all.filter(row => row.date >= start && row.date <= end);
  const through = all.filter(row => row.date <= end);
  const planRows = (await client.query(`SELECT p.id,to_char(p.planned_on,'YYYY-MM-DD') date,
    o.name org,a.name article,p.amount::text amount,p.direction
    FROM qarzhy.payment_plans p JOIN qarzhy.organizations o ON o.id=p.organization_id
    JOIN qarzhy.financial_articles a ON a.id=p.article_id
    WHERE ($1::bigint IS NULL OR p.organization_id=$1) AND p.status='planned'
    ORDER BY p.planned_on,p.id`, [organizationId])).rows;
  const budgetRows = (await client.query(`WITH selected AS (
      SELECT DISTINCT ON (v.scope_id) v.id,v.scope_id FROM qarzhy.budget_versions v
      JOIN qarzhy.report_scopes s ON s.id=v.scope_id
      WHERE s.scope_type='organization' AND v.year=$2 AND v.status='draft'
        AND v.name='Legacy ledger budget ' || v.year::text
        AND ($1::bigint IS NULL OR s.organization_id=$1)
      ORDER BY v.scope_id,v.id DESC
    ) SELECT to_char(b.month,'YYYY-MM') AS budget_month,o.name org,m.code metric,b.amount::text amount
      FROM selected v JOIN qarzhy.budget_items b ON b.budget_version_id=v.id
      JOIN qarzhy.report_metrics m ON m.id=b.metric_id
      JOIN qarzhy.report_scopes s ON s.id=v.scope_id
      JOIN qarzhy.organizations o ON o.id=s.organization_id
      WHERE b.month=$3 AND b.article_id IS NULL AND b.channel_id IS NULL
        AND m.code IN ('legacy.ledger.revenue','legacy.ledger.cost','legacy.ledger.opex',
          'legacy.ledger.depreciation','legacy.ledger.tax')
      ORDER BY m.code,o.name`, [organizationId, Number(month.slice(0, 4)), start])).rows;
  const periods = (await client.query(`SELECT bool_or(closed) closed FROM qarzhy.accounting_periods
    WHERE starts_on=$1 AND ($2::bigint IS NULL OR organization_id=$2)`, [start, organizationId])).rows;
  const audits = principal.organization_id ? [] : (await client.query(`SELECT id,to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') time,
    actor_name author,action,after_data,reason FROM qarzhy.audit_log
    ORDER BY occurred_at DESC,id DESC LIMIT 100`)).rows;
  const history = Array.from({ length: 9 }, (_, index) => {
    const value = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5) - 9 + index, 1)).toISOString().slice(0, 7);
    return { month: value, ...ledger(all.filter(row => row.date.startsWith(value))) };
  });
  return { source: 'ledger', user: userJson(principal), orgs: orgs.map(row => row.name), kinds,
    month, end, operations: current, allOperations: through,
    budget: budgetRows.map(row => ({ month: row.budget_month, org: row.org,
      metric: row.metric.slice('legacy.ledger.'.length), amount: safeDisplayMoney(row.amount) })),
    report: ledger(current),
    opening: ledger(all.filter(row => row.date < start)), balance: ledger(through),
    previous: ledger(all.filter(row => row.date.startsWith(priorYear(month)))), history,
    debts: debts(through, end), plans: planRows.map(row => ({ ...row, id: Number(row.id),
      amount: safeDisplayMoney(row.amount) })), closed: Boolean(periods[0]?.closed),
    audit: audits.map(row => ({ id: Number(row.id), time: row.time, author: row.author,
      action: row.action, detail: row.after_data?.legacy_detail || row.reason || JSON.stringify(row.after_data ?? {}) })),
    demo: all.some(row => row.source === 'demo'), workbookAvailable: true };
}
