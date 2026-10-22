import { createHash, randomUUID } from 'node:crypto';
import { requirePermission, AccessError } from '../auth/guards.mjs';
import { FinanceError, dateOnly, assertOpenPeriod } from './validation.mjs';
import { createDocument, postDocument } from './documents.mjs';
import { audit } from './audit.mjs';

const DOCUMENT_KINDS = { sale: 'sale', purchase: 'purchase', return: 'sale_return' };
const EVENT_KINDS = { expense: 'opex', depreciation: 'depreciation', tax: 'tax' };
const CASH_KINDS = new Set(['receipt', 'supplier_payment', 'expense_payment', 'tax_payment',
  'capital', 'loan', 'loan_payment', 'asset']);

function label(value, name, { required = false, max = 160 } = {}) {
  if (typeof value !== 'string') throw new FinanceError(`Invalid ${name}`);
  const result = value.trim();
  if ((required && !result) || result.length > max) throw new FinanceError(`Invalid ${name}`);
  return result;
}

function whole(value, name, positive = false) {
  if (!Number.isSafeInteger(value) || (positive ? value <= 0 : value < 0))
    throw new FinanceError(`Invalid ${name}`);
  return value;
}

async function namedCounterparty(client, name) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`portal-counterparty:${name.toLowerCase()}`]);
  const rows = (await client.query(`SELECT id FROM qarzhy.counterparties
    WHERE active=true AND name=$1 ORDER BY id LIMIT 2`, [name])).rows;
  if (rows.length > 1) throw new FinanceError('Ambiguous counterparty name', 409);
  if (rows.length) return rows[0].id;
  const code = createHash('sha256').update(name).digest('hex');
  return (await client.query(`INSERT INTO qarzhy.counterparties(name,external_namespace,external_code)
    VALUES($1,'portal',$2) RETURNING id`, [name, code])).rows[0].id;
}

async function namedArticle(client, name) {
  if (!name) return null;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`portal-article:${name.toLowerCase()}`]);
  const rows = (await client.query(`SELECT id FROM qarzhy.financial_articles
    WHERE active=true AND name=$1 ORDER BY id LIMIT 2`, [name])).rows;
  if (rows.length > 1) throw new FinanceError('Ambiguous financial article', 409);
  if (rows.length) return rows[0].id;
  return (await client.query(`INSERT INTO qarzhy.financial_articles(code,name)
    VALUES($1,$2) RETURNING id`, [`portal-${randomUUID()}`, name])).rows[0].id;
}

async function namedLocation(client, organizationId, name) {
  if (!name) return null;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`portal-location:${organizationId}:${name.toLowerCase()}`]);
  const rows = (await client.query(`SELECT id FROM qarzhy.locations
    WHERE organization_id=$1 AND active=true AND name=$2 ORDER BY id LIMIT 2`, [organizationId, name])).rows;
  if (rows.length > 1) throw new FinanceError('Ambiguous location', 409);
  if (rows.length) return rows[0].id;
  return (await client.query(`INSERT INTO qarzhy.locations(organization_id,code,name)
    VALUES($1,$2,$3) RETURNING id`, [organizationId, `portal-${randomUUID()}`, name])).rows[0].id;
}

function sameOperation(row, input, organizationId) {
  return String(row.organization_id) === String(organizationId) && row.kind === input.kind &&
    row.occurred_on === input.date && Number(row.amount) === input.amount &&
    Number(row.cost) === input.cost && row.point === input.point &&
    row.counterparty_label === input.counterparty && row.document_label === input.document &&
    (row.due_date || '') === input.due && row.article_label === input.article;
}

export async function createPortalOperation({ client, principal, input }) {
  requirePermission(principal, 'finance.write');
  const source = label(input.source, 'source', { required: true });
  const externalId = label(input.external_id, 'external ID', { required: true });
  const organizationName = label(input.org, 'organization', { required: true });
  const kind = label(input.kind, 'operation kind', { required: true });
  if (!Object.hasOwn(DOCUMENT_KINDS, kind) && !Object.hasOwn(EVENT_KINDS, kind) && !CASH_KINDS.has(kind))
    throw new FinanceError('Unsupported operation kind');
  const date = dateOnly(input.date);
  const amount = whole(input.amount, 'amount', true), cost = whole(input.cost ?? 0, 'cost');
  if (!['sale', 'return'].includes(kind) && cost)
    throw new FinanceError('Cost is only valid for a sale or return');
  const point = label(input.point ?? '', 'point');
  const counterparty = label(input.counterparty, 'counterparty', { required: true });
  const document = label(input.document, 'document', { required: true, max: 120 });
  const due = input.due ? dateOnly(input.due) : '';
  const article = label(input.article ?? '', 'article');
  const organizations = (await client.query(`SELECT id FROM qarzhy.organizations
    WHERE active=true AND name=$1 ORDER BY id LIMIT 2`, [organizationName])).rows;
  if (!organizations.length) throw new FinanceError('Organization not found', 404);
  if (organizations.length > 1) throw new FinanceError('Ambiguous organization name', 409);
  const organizationId = organizations[0].id;
  if (principal.organization_id && String(principal.organization_id) !== String(organizationId))
    throw new AccessError('Forbidden organization');
  await assertOpenPeriod(client, organizationId, date);
  const digest = createHash('sha256').update(JSON.stringify([source, externalId])).digest('hex');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`portal-operation:${digest}`]);
  const existing = (await client.query(`SELECT id,organization_id,kind,to_char(occurred_on,'YYYY-MM-DD') occurred_on,
    amount::text,cost::text,point,counterparty_label,document_label,
    to_char(due_date,'YYYY-MM-DD') due_date,article_label,document_id,financial_event_id,cash_movement_id
    FROM qarzhy.portal_operations WHERE source=$1 AND external_id=$2`, [source, externalId])).rows[0];
  const normalized = { kind, date, amount, cost, point, counterparty, document, due, article };
  if (existing) {
    if (!sameOperation(existing, normalized, organizationId)) throw new FinanceError('Idempotency key conflict', 409);
    return existing;
  }
  // Imported SQLite did not identify a cash account; the live schema requires a real one.
  if (CASH_KINDS.has(kind)) throw new FinanceError('Cash account selection is required before posting this operation', 422);

  const dataset = (await client.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
  if (!dataset) throw new FinanceError('Live dataset is missing', 503);
  await client.query(`INSERT INTO qarzhy.report_scopes(scope_type,organization_id)
    VALUES('organization',$1) ON CONFLICT (scope_type,organization_id) DO NOTHING`, [organizationId]);
  const scope = (await client.query(`SELECT id FROM qarzhy.report_scopes
    WHERE scope_type='organization' AND organization_id=$1`, [organizationId])).rows[0];
  const counterpartyId = await namedCounterparty(client, counterparty);
  const articleId = await namedArticle(client, article);
  const locationId = await namedLocation(client, organizationId, point);
  let documentId = null, eventId;
  if (Object.hasOwn(DOCUMENT_KINDS, kind)) {
    const created = await createDocument({ client, principal, input: {
      organizationId, kind: DOCUMENT_KINDS[kind], mode: 'summary', number: document,
      date, amount: String(amount), cogs: ['sale', 'return'].includes(kind) ? String(cost) : null,
      counterpartyId, articleId, locationId, dueDate: due || null,
      idempotencyKey: `portal:${digest}`,
    } });
    const posted = await postDocument({ client, principal, id: created.id, version: created.version,
      idempotencyKey: `portal:${digest}` });
    documentId = posted.id;
    eventId = (await client.query(`SELECT id FROM qarzhy.financial_events
      WHERE document_id=$1 AND posting_key=$2`, [documentId, `document:${documentId}:recognition`])).rows[0].id;
  } else {
    eventId = (await client.query(`INSERT INTO qarzhy.financial_events
      (dataset_id,scope_id,organization_id,occurred_on,event_kind,article_id,counterparty_id,
        amount,author_id,posting_key,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9) RETURNING id`,
    [dataset.id, scope.id, organizationId, date, EVENT_KINDS[kind], articleId,
      counterpartyId, String(amount), principal.id, `portal:${digest}:event`])).rows[0].id;
  }
  const saved = (await client.query(`INSERT INTO qarzhy.portal_operations
    (organization_id,source,external_id,occurred_on,kind,amount,cost,point,counterparty_label,
      document_label,due_date,article_label,document_id,financial_event_id,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
  [organizationId, source, externalId, date, kind, String(amount), String(cost), point,
    counterparty, document, due || null, article, documentId, eventId, principal.id])).rows[0];
  await audit(client, principal, 'portal_operation_create', 'portal_operation', saved.id,
    { after: { source, external_id: externalId, kind, amount, cost, document } });
  return saved;
}
