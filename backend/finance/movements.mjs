import { requirePermission, AccessError } from '../auth/guards.mjs';
import { Exact, FinanceError, money, dateOnly, id, assertOpenPeriod } from './validation.mjs';
import { audit } from './audit.mjs';

export async function recordMovement({ client, principal, input }) {
  requirePermission(principal, 'finance.write');
  const organizationId = id(input.organizationId, 'organization ID');
  if (principal.organization_id && String(principal.organization_id) !== organizationId) throw new AccessError('Forbidden organization');
  const accountId = id(input.cashAccountId, 'cash account ID');
  const date = dateOnly(input.date);
  const amount = money(input.amount, { allowZero: false });
  if (!['in', 'out'].includes(input.direction)) throw new FinanceError('Invalid cash direction');
  if (typeof input.postingKey !== 'string' || !input.postingKey.trim() || input.postingKey.length > 160) throw new FinanceError('Invalid posting key');
  await assertOpenPeriod(client, organizationId, date);
  const account = (await client.query('SELECT organization_id FROM qarzhy.cash_accounts WHERE id=$1 AND active=true', [accountId])).rows[0];
  if (!account || String(account.organization_id) !== organizationId) throw new FinanceError('Cash account and organization mismatch');
  const dataset = (await client.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
  const scope = (await client.query("SELECT id FROM qarzhy.report_scopes WHERE scope_type='organization' AND organization_id=$1", [organizationId])).rows[0];
  if (!dataset || !scope) throw new FinanceError('Live scope is missing');
  const existing = (await client.query('SELECT * FROM qarzhy.cash_movements WHERE dataset_id=$1 AND posting_key=$2',
    [dataset.id, input.postingKey])).rows[0];
  if (existing) {
    if (String(existing.organization_id) !== organizationId || String(existing.cash_account_id) !== accountId ||
        existing.direction !== input.direction || String(existing.amount) !== amount ||
        String(existing.counterparty_id ?? '') !== String(input.counterpartyId ?? ''))
      throw new FinanceError('Posting key conflict', 409);
    return existing;
  }
  const movement = (await client.query(`INSERT INTO qarzhy.cash_movements
    (dataset_id,scope_id,organization_id,cash_account_id,occurred_on,direction,amount,article_id,
     counterparty_id,note,posting_key,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [dataset.id, scope.id,
    organizationId, accountId, date, input.direction, amount,
    input.articleId ? id(input.articleId) : null, input.counterpartyId ? id(input.counterpartyId) : null,
    typeof input.note === 'string' ? input.note.slice(0, 2000) : '', input.postingKey, principal.id])).rows[0];
  await audit(client, principal, 'cash_movement_create', 'cash_movement', movement.id,
    { after: { direction: movement.direction, amount } });
  return movement;
}

export async function settleDocument({ client, principal, documentId, movementId, amount }) {
  requirePermission(principal, 'finance.write');
  const allocation = money(amount, { allowZero: false });
  const document = (await client.query('SELECT * FROM qarzhy.documents WHERE id=$1 FOR UPDATE', [id(documentId)])).rows[0];
  const movement = (await client.query('SELECT * FROM qarzhy.cash_movements WHERE id=$1 FOR UPDATE', [id(movementId)])).rows[0];
  if (!document || !movement) throw new FinanceError('Document or movement not found', 404);
  if (document.status !== 'posted') throw new FinanceError('Only posted documents can be settled');
  if (principal.organization_id && String(principal.organization_id) !== String(document.organization_id)) throw new AccessError('Forbidden organization');
  if (String(document.organization_id) !== String(movement.organization_id) ||
    String(document.dataset_id) !== String(movement.dataset_id) ||
    String(document.counterparty_id ?? '') !== String(movement.counterparty_id ?? ''))
    throw new FinanceError('Settlement context mismatch');
  const requiredDirection = ['sale', 'purchase_return'].includes(document.kind) ? 'in' : 'out';
  if (movement.direction !== requiredDirection) throw new FinanceError('Settlement direction mismatch');
  const settled = (await client.query(`SELECT coalesce(sum(amount),0)::text AS amount FROM qarzhy.document_settlements
    WHERE document_id=$1`, [document.id])).rows[0].amount;
  const allocated = (await client.query(`SELECT coalesce(sum(amount),0)::text AS amount FROM qarzhy.document_settlements
    WHERE cash_movement_id=$1`, [movement.id])).rows[0].amount;
  if (new Exact(settled).plus(allocation).greaterThan(document.total_amount)) throw new FinanceError('Settlement exceeds document remaining amount');
  if (new Exact(allocated).plus(allocation).greaterThan(movement.amount)) throw new FinanceError('Settlement exceeds movement remaining amount');
  const row = (await client.query(`INSERT INTO qarzhy.document_settlements
    (document_id,cash_movement_id,amount,created_by) VALUES($1,$2,$3,$4) RETURNING *`,
    [document.id, movement.id, allocation, principal.id])).rows[0];
  await audit(client, principal, 'document_settle', 'document', document.id,
    { after: { cash_movement_id: movement.id, amount: allocation } });
  return row;
}

export async function listMovements({ pool, principal, filters = {} }) {
  requirePermission(principal, 'finance.read');
  const params = [];
  const where = ['true'];
  if (principal.organization_id) { params.push(principal.organization_id); where.push(`m.organization_id=$${params.length}`); }
  if (filters.datasetKind) { params.push(filters.datasetKind); where.push(`d.kind=$${params.length}`); }
  else where.push("d.kind='live'");
  if (filters.start) { params.push(dateOnly(filters.start)); where.push(`m.occurred_on>=$${params.length}`); }
  if (filters.end) { params.push(dateOnly(filters.end)); where.push(`m.occurred_on<=$${params.length}`); }
  const rows = (await pool.query(`SELECT m.id,m.occurred_on,m.direction,m.amount::text,m.note,m.organization_id,
    m.cash_account_id,m.counterparty_id,d.kind AS dataset_kind
    FROM qarzhy.cash_movements m JOIN qarzhy.datasets d ON d.id=m.dataset_id
    WHERE ${where.join(' AND ')} ORDER BY m.occurred_on DESC,m.id DESC LIMIT 500`, params)).rows;
  return rows;
}
