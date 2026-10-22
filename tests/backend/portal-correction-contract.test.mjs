import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { withTransaction } from '../../backend/db/connection.mjs';
import { createPortalOperation } from '../../backend/finance/portal-operations.mjs';
import { correctPortalOperation } from '../../backend/finance/portal-correction.mjs';
import { buildLegacyLedgerData } from '../../backend/reports/legacy-ledger.mjs';

test('portal correction preserves original facts and replaces one live sale and expense',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
    try {
      const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('portal_correction_org','Portal Correction Org') RETURNING id")).rows[0];
      const user = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,organization_id,password_salt,password_hash)
        VALUES('portalcorrectionfinance','Portal Correction Finance',(SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2,$3)
        RETURNING id`, [org.id, '0'.repeat(32), '0'.repeat(128)])).rows[0];
      const principal = { id: user.id, name: 'Portal Correction Finance', role: 'finance',
        organization_id: org.id, active: true, password_change_due: false,
        permissions: ['finance.read', 'finance.write'] };
      const input = { source: 'manual', external_id: 'correction-sale-1', date: '2037-07-09',
        org: 'Portal Correction Org', point: '', counterparty: 'Buyer Correction',
        document: 'SALE-CORR', kind: 'sale', amount: 1000, cost: 400, due: '', article: 'Books' };
      const original = await withTransaction(pool, client => createPortalOperation({ client, principal, input }));
      const result = await withTransaction(pool, client => correctPortalOperation({ client, principal,
        input: { id: -Number(original.id), amount: 1200, cost: 500, reason: 'Correct price' } }));
      assert.equal(result.amount, '1200.00');
      const oldDoc = (await pool.query('SELECT total_amount::text,status FROM qarzhy.documents WHERE id=$1',
        [original.document_id])).rows[0];
      assert.deepEqual(oldDoc, { total_amount: '1000.00', status: 'reversed' });
      const oldEvents = (await pool.query(`SELECT amount::text,reverses_event_id FROM qarzhy.financial_events
        WHERE document_id=$1 ORDER BY id`, [original.document_id])).rows;
      assert.deepEqual(oldEvents.map(row => row.amount), ['1000.00', '-1000.00']);
      assert.equal(String(oldEvents[1].reverses_event_id), String(original.financial_event_id));
      const afterSale = await buildLegacyLedgerData({ pool, principal, filters: { month: '2037-07' } });
      assert.equal(afterSale.operations.length, 1);
      assert.equal(afterSale.report.revenue, 1200);
      assert.equal(afterSale.report.cost, 500);
      assert.equal(afterSale.balance.difference, 0);
      await assert.rejects(withTransaction(pool, client => correctPortalOperation({ client, principal,
        input: { id: -Number(original.id), amount: 1300, cost: 500, reason: 'Again' } })), /already reversed/i);

      const expense = await withTransaction(pool, client => createPortalOperation({ client, principal,
        input: { ...input, external_id: 'correction-expense-1', document: 'EXP-CORR',
          kind: 'expense', amount: 50, cost: 0 } }));
      await withTransaction(pool, client => correctPortalOperation({ client, principal,
        input: { id: -Number(expense.id), amount: 70, cost: 0, reason: 'Correct expense' } }));
      const expenseFacts = (await pool.query(`SELECT amount::text,reverses_event_id FROM qarzhy.financial_events
        WHERE id=$1 OR reverses_event_id=$1 ORDER BY id`, [expense.financial_event_id])).rows;
      assert.deepEqual(expenseFacts.map(row => row.amount), ['50', '-50.00']);
      assert.equal((await buildLegacyLedgerData({ pool, principal,
        filters: { month: '2037-07' } })).report.profit, 630);
      assert.equal((await pool.query(`SELECT count(*)::int n FROM qarzhy.audit_log
        WHERE action='portal_operation_correct' AND reason IN ('Correct price','Correct expense')`)).rows[0].n, 2);
      await assert.rejects(withTransaction(pool, client => correctPortalOperation({ client, principal,
        input: { id: 5, amount: 100, cost: 0, reason: 'Imported' } })), /imported/i);
    } finally { await pool.end(); }
  });
