import { requirePermission, AccessError } from '../auth/guards.mjs';
import { Exact, FinanceError, money, quantity, dateOnly, id, assertOpenPeriod } from './validation.mjs';
import { audit } from './audit.mjs';

const KINDS = new Set(['sale', 'purchase', 'sale_return', 'purchase_return']);

function organizationScope(principal, organizationId) {
  if (principal.organization_id && String(principal.organization_id) !== String(organizationId)) throw new AccessError('Forbidden organization');
}

async function liveDataset(client) {
  const row = (await client.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
  if (!row) throw new FinanceError('Live dataset is missing', 503);
  return row.id;
}

export async function createDocument({ client, principal, input }) {
  requirePermission(principal, 'finance.write');
  const organizationId = id(input.organizationId, 'organization ID');
  organizationScope(principal, organizationId);
  if (!KINDS.has(input.kind)) throw new FinanceError('Invalid document kind');
  if (!['summary', 'itemized'].includes(input.mode)) throw new FinanceError('Invalid document mode');
  if (typeof input.number !== 'string' || !input.number.trim() || input.number.length > 120) throw new FinanceError('Invalid document number');
  if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 160) throw new FinanceError('Invalid idempotency key');
  const occurredOn = dateOnly(input.date);
  const amount = money(input.amount, { allowZero: false });
  const cogs = input.cogs == null ? null : money(input.cogs);
  const lines = input.lines ?? [];
  if (!Array.isArray(lines) || lines.length > 500) throw new FinanceError('Invalid document lines');
  if (input.mode === 'summary' && lines.length) throw new FinanceError('Summary document cannot have lines');
  if (input.mode === 'itemized' && !lines.length) throw new FinanceError('Itemized document requires lines');
  await assertOpenPeriod(client, organizationId, occurredOn);
  const datasetId = await liveDataset(client);
  const existing = (await client.query(`SELECT * FROM qarzhy.documents WHERE dataset_id=$1 AND idempotency_key=$2`,
    [datasetId, input.idempotencyKey])).rows[0];
  if (existing) {
    const same = String(existing.organization_id) === organizationId && existing.kind === input.kind &&
      existing.input_mode === input.mode && existing.number === input.number.trim() &&
      String(existing.total_amount) === amount && String(existing.cogs_amount ?? '') === String(cogs ?? '') &&
      String(existing.counterparty_id ?? '') === String(input.counterpartyId ?? '') &&
      String(existing.document_date instanceof Date ? existing.document_date.toISOString().slice(0, 10) : existing.document_date) === occurredOn;
    if (!same) throw new FinanceError('Idempotency key conflict', 409);
    if (input.mode === 'itemized') {
      const originalLines = (await client.query(`SELECT product_id,warehouse_id,quantity::text,unit_price::text,
        discount_amount::text,line_amount::text,cogs_amount::text FROM qarzhy.document_lines
        WHERE document_id=$1 ORDER BY line_number`, [existing.id])).rows;
      if (originalLines.length !== lines.length) throw new FinanceError('Idempotency key conflict', 409);
      for (let index = 0; index < lines.length; index++) {
        const submitted = lines[index], saved = originalLines[index];
        const expectedAmount = new Exact(quantity(submitted.quantity)).times(quantity(submitted.unitPrice))
          .toDecimalPlaces(2).minus(money(submitted.discount ?? '0')).toFixed(2);
        if (String(saved.product_id) !== String(submitted.productId) ||
          String(saved.warehouse_id ?? '') !== String(submitted.warehouseId ?? '') ||
          new Exact(saved.quantity).toFixed(6) !== quantity(submitted.quantity) ||
          new Exact(saved.unit_price).toFixed(6) !== quantity(submitted.unitPrice) ||
          saved.discount_amount !== money(submitted.discount ?? '0') || saved.line_amount !== expectedAmount ||
          String(saved.cogs_amount ?? '') !== String(submitted.cogs == null ? '' : money(submitted.cogs)))
          throw new FinanceError('Idempotency key conflict', 409);
      }
    }
    return existing;
  }
  const document = (await client.query(`INSERT INTO qarzhy.documents
    (dataset_id,organization_id,location_id,counterparty_id,channel_id,article_id,kind,input_mode,number,
     document_date,due_date,total_amount,cogs_amount,idempotency_key,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [
    datasetId, organizationId, input.locationId ? id(input.locationId) : null,
    input.counterpartyId ? id(input.counterpartyId) : null, input.channelId ? id(input.channelId) : null,
    input.articleId ? id(input.articleId) : null, input.kind, input.mode, input.number.trim(), occurredOn,
    input.dueDate ? dateOnly(input.dueDate) : null, amount, cogs, input.idempotencyKey, principal.id,
  ])).rows[0];
  let lineTotal = new Exact(0);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const qty = quantity(line.quantity);
    const price = quantity(line.unitPrice);
    const discount = money(line.discount ?? '0');
    const lineAmount = new Exact(qty).times(price).toDecimalPlaces(2).minus(discount);
    if (lineAmount.isNegative()) throw new FinanceError('Line discount exceeds value');
    lineTotal = lineTotal.plus(lineAmount);
    await client.query(`INSERT INTO qarzhy.document_lines
      (document_id,line_number,product_id,warehouse_id,quantity,unit_price,discount_amount,line_amount,cogs_amount,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [document.id, index + 1, id(line.productId),
      line.warehouseId ? id(line.warehouseId) : null, qty, price, discount, lineAmount.toFixed(2),
      line.cogs == null ? null : money(line.cogs), principal.id]);
  }
  if (input.mode === 'itemized' && !lineTotal.equals(amount)) throw new FinanceError('Document lines do not match total amount');
  await audit(client, principal, 'document_create', 'document', document.id, { after: { number: document.number, status: 'draft' } });
  return document;
}

export async function postDocument({ client, principal, id: documentId, version, idempotencyKey }) {
  requirePermission(principal, 'finance.write');
  const document = (await client.query(`SELECT d.*,ds.kind AS dataset_kind FROM qarzhy.documents d
    JOIN qarzhy.datasets ds ON ds.id=d.dataset_id WHERE d.id=$1 FOR UPDATE OF d`, [id(documentId)])).rows[0];
  if (!document) throw new FinanceError('Document not found', 404);
  if (document.dataset_kind !== 'live') throw new AccessError('Imported documents are immutable');
  organizationScope(principal, document.organization_id);
  if (document.idempotency_key !== idempotencyKey) throw new FinanceError('Idempotency key mismatch', 409);
  if (document.status === 'posted') return document;
  if (document.status !== 'draft') throw new FinanceError('Document cannot be posted', 409);
  if (Number(document.version) !== Number(version)) throw new FinanceError('Document version conflict', 409);
  if (!document.counterparty_id) throw new FinanceError('Counterparty is required');
  await assertOpenPeriod(client, document.organization_id, document.document_date);
  const scope = (await client.query(`SELECT id FROM qarzhy.report_scopes WHERE scope_type='organization' AND organization_id=$1`,
    [document.organization_id])).rows[0];
  if (!scope) throw new FinanceError('Organization report scope is missing', 422);
  const type = {
    sale: 'revenue', purchase: 'purchase', sale_return: 'return', purchase_return: 'return',
  }[document.kind];
  const sign = document.kind.endsWith('_return') ? '-' : '';
  await client.query(`INSERT INTO qarzhy.financial_events
    (dataset_id,scope_id,organization_id,occurred_on,event_kind,article_id,channel_id,counterparty_id,
     document_id,amount,cost_amount,author_id,posting_key,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$12)`, [document.dataset_id, scope.id,
    document.organization_id, document.document_date, type, document.article_id, document.channel_id,
    document.counterparty_id, document.id, `${sign}${document.total_amount}`,
    document.cogs_amount == null ? null : `${sign}${document.cogs_amount}`, principal.id,
    `document:${document.id}:recognition`]);
  const posted = (await client.query(`UPDATE qarzhy.documents SET status='posted',version=version+1,updated_at=now()
    WHERE id=$1 RETURNING *`, [document.id])).rows[0];
  await audit(client, principal, 'document_post', 'document', document.id, { before: { status: 'draft' }, after: { status: 'posted' } });
  return posted;
}

export async function reverseDocument({ client, principal, id: documentId, reason, now = new Date() }) {
  requirePermission(principal, 'finance.write');
  if (typeof reason !== 'string' || !reason.trim()) throw new FinanceError('Reversal reason is required');
  const document = (await client.query(`SELECT d.*,ds.kind AS dataset_kind FROM qarzhy.documents d
    JOIN qarzhy.datasets ds ON ds.id=d.dataset_id WHERE d.id=$1 FOR UPDATE OF d`, [id(documentId)])).rows[0];
  if (!document) throw new FinanceError('Document not found', 404);
  if (document.dataset_kind !== 'live') throw new AccessError('Imported documents are immutable');
  organizationScope(principal, document.organization_id);
  if (document.status === 'reversed') return document;
  if (document.status !== 'posted') throw new FinanceError('Only posted documents can be reversed', 409);
  const allocated = (await client.query('SELECT count(*)::integer AS n FROM qarzhy.document_settlements WHERE document_id=$1', [document.id])).rows[0].n;
  if (allocated) throw new FinanceError('Settled document requires settlement reversal first', 409);
  const originalDate = document.document_date instanceof Date
    ? document.document_date.toISOString().slice(0, 10) : String(document.document_date);
  const reversalDate = dateOnly([new Date(now).toISOString().slice(0, 10), originalDate].sort().at(-1));
  await assertOpenPeriod(client, document.organization_id, reversalDate);
  const originals = (await client.query(`SELECT * FROM qarzhy.financial_events
    WHERE document_id=$1 AND reverses_event_id IS NULL ORDER BY id FOR UPDATE`, [document.id])).rows;
  if (!originals.length) throw new FinanceError('Document has no financial event', 409);
  for (const original of originals) {
    await client.query(`INSERT INTO qarzhy.financial_events
      (dataset_id,scope_id,organization_id,occurred_on,event_kind,article_id,channel_id,counterparty_id,
       document_id,amount,cost_amount,author_id,reverses_event_id,posting_key,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$12)`, [original.dataset_id,
      original.scope_id, original.organization_id, reversalDate, original.event_kind, original.article_id,
      original.channel_id, original.counterparty_id, document.id,
      new Exact(original.amount).negated().toFixed(2),
      original.cost_amount == null ? null : new Exact(original.cost_amount).negated().toFixed(2),
      principal.id, original.id, `document:${document.id}:reversal:${original.id}`]);
  }
  const reversed = (await client.query(`UPDATE qarzhy.documents SET status='reversed',version=version+1,updated_at=now()
    WHERE id=$1 RETURNING *`, [document.id])).rows[0];
  await audit(client, principal, 'document_reverse', 'document', document.id,
    { before: { status: 'posted' }, after: { status: 'reversed' }, reason: reason.trim() });
  return reversed;
}

export async function listOperations({ pool, principal, filters = {} }) {
  requirePermission(principal, 'finance.read');
  const params = [];
  const where = ["ds.kind='live'"];
  if (principal.organization_id) { params.push(principal.organization_id); where.push(`d.organization_id=$${params.length}`); }
  if (filters.organizationId) { params.push(id(filters.organizationId)); where.push(`d.organization_id=$${params.length}`); }
  if (filters.start) { params.push(dateOnly(filters.start)); where.push(`d.document_date >= $${params.length}`); }
  if (filters.end) { params.push(dateOnly(filters.end)); where.push(`d.document_date <= $${params.length}`); }
  const result = await pool.query(`SELECT d.id,d.number,d.kind,d.document_date,d.status,d.total_amount::text,
    d.cogs_amount::text,d.version,d.organization_id,o.name AS organization_name,c.name AS counterparty_name
    FROM qarzhy.documents d JOIN qarzhy.datasets ds ON ds.id=d.dataset_id
    JOIN qarzhy.organizations o ON o.id=d.organization_id
    LEFT JOIN qarzhy.counterparties c ON c.id=d.counterparty_id
    WHERE ${where.join(' AND ')} ORDER BY d.document_date DESC,d.id DESC LIMIT 500`, params);
  return result.rows;
}
