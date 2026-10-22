import { randomUUID } from 'node:crypto';
import { AccessError, requirePermission } from '../auth/guards.mjs';
import { audit } from './audit.mjs';
import { reverseDocument } from './documents.mjs';
import { createPortalOperation } from './portal-operations.mjs';
import { assertOpenPeriod, Exact, FinanceError } from './validation.mjs';

function whole(value, name, positive = false) {
  if (!Number.isSafeInteger(value) || (positive ? value <= 0 : value < 0))
    throw new FinanceError(`Invalid ${name}`);
  return value;
}

export async function correctPortalOperation({ client, principal, input }) {
  requirePermission(principal, 'finance.write');
  if (!input || !Number.isSafeInteger(input.id) || input.id === 0)
    throw new FinanceError('Invalid operation ID');
  if (input.id > 0) throw new FinanceError('Imported operations cannot be corrected here', 409);
  const amount = whole(input.amount, 'amount', true);
  const cost = whole(input.cost ?? 0, 'cost');
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000)
    throw new FinanceError('Correction reason is required');
  const reason = input.reason.trim();
  const operation = (await client.query(`SELECT p.*,o.name AS organization_name,
    to_char(p.occurred_on,'YYYY-MM-DD') AS operation_date,
    to_char(p.due_date,'YYYY-MM-DD') AS due_date_text
    FROM qarzhy.portal_operations p JOIN qarzhy.organizations o ON o.id=p.organization_id
    WHERE p.id=$1 FOR UPDATE OF p`, [-input.id])).rows[0];
  if (!operation) throw new FinanceError('Operation not found', 404);
  if (principal.organization_id && String(principal.organization_id) !== String(operation.organization_id))
    throw new AccessError('Forbidden organization');
  if (!['sale', 'return'].includes(operation.kind) && cost)
    throw new FinanceError('Cost is only valid for a sale or return');
  if (Number(operation.amount) === amount && Number(operation.cost) === cost)
    throw new FinanceError('Correction has no changes', 409);
  await assertOpenPeriod(client, operation.organization_id, operation.operation_date);
  if (operation.document_id) {
    const status = (await client.query('SELECT status FROM qarzhy.documents WHERE id=$1',
      [operation.document_id])).rows[0]?.status;
    if (status === 'reversed') throw new FinanceError('Operation already reversed', 409);
    if (status !== 'posted') throw new FinanceError('Operation document is not posted', 409);
    await reverseDocument({ client, principal, id: operation.document_id, reason,
      now: new Date(`${operation.operation_date}T00:00:00Z`) });
  } else {
    const event = (await client.query(`SELECT * FROM qarzhy.financial_events
      WHERE id=$1 FOR UPDATE`, [operation.financial_event_id])).rows[0];
    if (!event) throw new FinanceError('Operation event not found', 409);
    const reversed = (await client.query(`SELECT 1 FROM qarzhy.financial_events
      WHERE reverses_event_id=$1`, [event.id])).rows.length > 0;
    if (reversed) throw new FinanceError('Operation already reversed', 409);
    await client.query(`INSERT INTO qarzhy.financial_events
      (dataset_id,scope_id,organization_id,occurred_on,event_kind,article_id,channel_id,counterparty_id,
       amount,cost_amount,author_id,reverses_event_id,posting_key,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$11)`, [event.dataset_id,
      event.scope_id, event.organization_id, operation.operation_date, event.event_kind,
      event.article_id, event.channel_id, event.counterparty_id,
      new Exact(event.amount).negated().toFixed(2),
      event.cost_amount == null ? null : new Exact(event.cost_amount).negated().toFixed(2),
      principal.id, event.id, `portal:correction:${randomUUID()}:reverse`]);
  }
  const replacement = await createPortalOperation({ client, principal, input: {
    source: operation.source, external_id: `correction-${randomUUID()}`,
    date: operation.operation_date, org: operation.organization_name, point: operation.point,
    counterparty: operation.counterparty_label, document: operation.document_label,
    kind: operation.kind, amount, cost, due: operation.due_date_text ?? '',
    article: operation.article_label,
  } });
  await audit(client, principal, 'portal_operation_correct', 'portal_operation', operation.id, {
    before: { amount: operation.amount, cost: operation.cost },
    after: { replacement_id: replacement.id, amount, cost }, reason,
  });
  return replacement;
}
