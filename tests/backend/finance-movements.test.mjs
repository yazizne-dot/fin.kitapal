import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { withTransaction } from '../../backend/db/connection.mjs';
import { createDocument, postDocument } from '../../backend/finance/documents.mjs';
import { recordMovement, settleDocument } from '../../backend/finance/movements.mjs';

test('partial settlement records cash once and overpayment rolls back both rows', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('movement_org','Movement Org') RETURNING id")).rows[0];
    await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1)", [org.id]);
    const customer = (await pool.query("INSERT INTO qarzhy.counterparties(name) VALUES('Movement Customer') RETURNING id")).rows[0];
    const cash = (await pool.query("INSERT INTO qarzhy.cash_accounts(organization_id,code,name,account_type) VALUES($1,'movement_cash','Movement Cash','bank') RETURNING id", [org.id])).rows[0];
    const user = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,password_salt,password_hash)
      VALUES('movementfinance','Movement Finance',(SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2) RETURNING id`, ['0'.repeat(32), '0'.repeat(128)])).rows[0];
    const principal = { id: user.id, name: 'Movement Finance', permissions: ['finance.write'] };
    const draft = await withTransaction(pool, client => createDocument({ client, principal, input: {
      organizationId: org.id, counterpartyId: customer.id, kind: 'sale', mode: 'summary',
      number: 'MV-SALE-1', date: '2026-10-21', amount: '100.00', idempotencyKey: 'mv-sale-1',
    } }));
    const doc = await withTransaction(pool, client => postDocument({ client, principal, id: draft.id, version: draft.version, idempotencyKey: 'mv-sale-1' }));
    const first = await withTransaction(pool, async client => {
      const movement = await recordMovement({ client, principal, input: { organizationId: org.id, cashAccountId: cash.id,
        counterpartyId: customer.id, direction: 'in', date: '2026-10-21', amount: '40.00', postingKey: 'mv-receipt-1' } });
      await settleDocument({ client, principal, documentId: doc.id, movementId: movement.id, amount: '40.00' });
      return movement;
    });
    assert.equal(first.amount, '40.00');
    const before = (await pool.query('SELECT count(*)::integer AS n FROM qarzhy.cash_movements')).rows[0].n;
    await assert.rejects(withTransaction(pool, async client => {
      const movement = await recordMovement({ client, principal, input: { organizationId: org.id, cashAccountId: cash.id,
        counterpartyId: customer.id, direction: 'in', date: '2026-10-21', amount: '70.00', postingKey: 'mv-receipt-overpay' } });
      await settleDocument({ client, principal, documentId: doc.id, movementId: movement.id, amount: '70.00' });
    }), /remaining|exceeds|overpay/i);
    const after = (await pool.query('SELECT count(*)::integer AS n FROM qarzhy.cash_movements')).rows[0].n;
    assert.equal(after, before);
    const settlement = await pool.query('SELECT amount::text FROM qarzhy.document_settlements WHERE document_id=$1', [doc.id]);
    assert.deepEqual(settlement.rows.map(row => row.amount), ['40.00']);
  } finally { await pool.end(); }
});
