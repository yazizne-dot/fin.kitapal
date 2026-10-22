import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { withTransaction } from '../../backend/db/connection.mjs';
import { createPortalOperation } from '../../backend/finance/portal-operations.mjs';
import { buildLegacyLedgerData } from '../../backend/reports/legacy-ledger.mjs';
import { getPnlPeriod } from '../../backend/reports/pnl.mjs';

test('portal operation posts one live sale, is idempotent, and rejects cash without a real account',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
    try {
      const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('portal_operation_org','Portal Operation Org') RETURNING id")).rows[0];
      const user = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,organization_id,password_salt,password_hash)
        VALUES('portaloperationfinance','Portal Operation Finance',(SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2,$3)
        RETURNING id`, [org.id, '0'.repeat(32), '0'.repeat(128)])).rows[0];
      const principal = { id: user.id, name: 'Portal Operation Finance', role: 'finance',
        organization_id: org.id, active: true, password_change_due: false,
        permissions: ['finance.read', 'finance.write'] };
      const input = { source: 'manual', external_id: 'sale-2035-1', date: '2035-04-05',
        org: 'Portal Operation Org', point: 'Center', counterparty: 'Buyer One',
        document: 'SALE-1', kind: 'sale', amount: 1000, cost: 400,
        due: '2035-04-25', article: 'Books' };
      const first = await withTransaction(pool, client => createPortalOperation({ client, principal, input }));
      const repeat = await withTransaction(pool, client => createPortalOperation({ client, principal, input }));
      assert.equal(first.id, repeat.id);
      assert.equal((await pool.query(`SELECT count(*)::int n FROM qarzhy.portal_operations
        WHERE organization_id=$1`, [org.id])).rows[0].n, 1);
      assert.equal((await pool.query('SELECT count(*)::int n FROM qarzhy.financial_events WHERE document_id=$1', [first.document_id])).rows[0].n, 1);
      const data = await buildLegacyLedgerData({ pool, principal, filters: { month: '2035-04' } });
      assert.equal(data.operations.length, 1);
      assert.equal(data.operations[0].external_id, 'sale-2035-1');
      assert.equal(data.operations[0].point, 'Center');
      assert.equal(data.operations[0].document, 'SALE-1');
      assert.equal(data.report.revenue, 1000);
      assert.equal(data.report.cost, 400);
      assert.equal(data.balance.difference, 0);
      for (const [kind, amount, cost] of [
        ['return', 100, 40], ['purchase', 300, 0], ['expense', 50, 0],
        ['tax', 20, 0], ['depreciation', 10, 0],
      ]) await withTransaction(pool, client => createPortalOperation({ client, principal,
        input: { ...input, external_id: `${kind}-2035-1`, document: kind.toUpperCase(),
          kind, amount, cost } }));
      const allKinds = await buildLegacyLedgerData({ pool, principal, filters: { month: '2035-04' } });
      assert.deepEqual(allKinds.operations.map(row => row.kind).sort(),
        ['depreciation', 'expense', 'purchase', 'return', 'sale', 'tax']);
      assert.equal(allKinds.report.revenue, 900);
      assert.equal(allKinds.report.cost, 360);
      assert.equal(allKinds.report.profit, 460);
      assert.equal(allKinds.balance.difference, 0);
      const scope = (await pool.query(`SELECT id FROM qarzhy.report_scopes
        WHERE organization_id=$1 AND scope_type='organization'`, [org.id])).rows[0];
      const livePnl = await getPnlPeriod({ pool, principal, scopeId: scope.id,
        start: '2035-04-01', end: '2035-05-01', source: 'events' });
      assert.equal(livePnl.figures.profit, null);
      assert.ok(livePnl.warnings.some(warning => /depreciation/i.test(warning)));
      await assert.rejects(withTransaction(pool, client => createPortalOperation({ client, principal,
        input: { ...input, amount: 2000 } })), /idempotency key conflict/i);
      await assert.rejects(withTransaction(pool, client => createPortalOperation({ client, principal,
        input: { ...input, external_id: 'receipt-2035-1', kind: 'receipt', cost: 0 } })), /cash account/i);
      assert.equal((await pool.query('SELECT count(*)::int n FROM qarzhy.cash_movements WHERE organization_id=$1', [org.id])).rows[0].n, 0);
      await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('portal_operation_other','Other Operation Org')");
      await assert.rejects(withTransaction(pool, client => createPortalOperation({ client, principal,
        input: { ...input, external_id: 'other-2035-1', org: 'Other Operation Org' } })), /forbidden/i);
      await pool.query(`INSERT INTO qarzhy.accounting_periods(organization_id,starts_on,closed)
        VALUES($1,'2035-04-01',true)`, [org.id]);
      await assert.rejects(withTransaction(pool, client => createPortalOperation({ client, principal,
        input: { ...input, external_id: 'closed-2035-1' } })), /closed period/i);
    } finally { await pool.end(); }
  });
