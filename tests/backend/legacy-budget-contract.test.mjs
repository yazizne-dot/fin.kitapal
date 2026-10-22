import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { withTransaction } from '../../backend/db/connection.mjs';
import { saveLegacyBudget } from '../../backend/finance/planning.mjs';
import { buildLegacyLedgerData } from '../../backend/reports/legacy-ledger.mjs';

test('legacy budget form saves one organization draft and the ledger reads it without changing facts',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
    try {
      const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('legacy_budget_org','Legacy Budget Org') RETURNING id")).rows[0];
      const other = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('legacy_budget_other','Other Budget Org') RETURNING id")).rows[0];
      const user = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,organization_id,password_salt,password_hash)
        VALUES('legacybudgetfinance','Legacy Budget Finance',(SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2,$3)
        RETURNING id`, [org.id, '0'.repeat(32), '0'.repeat(128)])).rows[0];
      const principal = { id: user.id, name: 'Legacy Budget Finance', role: 'finance',
        organization_id: org.id, active: true, password_change_due: false,
        permissions: ['finance.read', 'finance.write'] };
      const input = { month: '2033-05', org: 'Legacy Budget Org', metric: 'revenue', amount: 1000 };
      const first = await withTransaction(pool, client => saveLegacyBudget({ client, principal, input }));
      const revised = await withTransaction(pool, client => saveLegacyBudget({ client, principal,
        input: { ...input, amount: 1250 } }));
      await withTransaction(pool, client => saveLegacyBudget({ client, principal,
        input: { ...input, metric: 'depreciation', amount: 35 } }));
      assert.equal(first.id, revised.id);
      assert.equal(revised.amount, '1250.00');
      const versions = await pool.query(`SELECT count(*)::int n FROM qarzhy.budget_versions v
        JOIN qarzhy.report_scopes s ON s.id=v.scope_id WHERE s.organization_id=$1`, [org.id]);
      assert.equal(versions.rows[0].n, 1);
      const data = await buildLegacyLedgerData({ pool, principal, filters: { month: '2033-05' } });
      assert.deepEqual(data.budget.map(row => [row.metric, row.amount]),
        [['depreciation', 35], ['revenue', 1250]]);
      assert.deepEqual(data.orgs, ['Legacy Budget Org']);
      assert.equal(data.report.revenue, 0);
      assert.equal((await pool.query(`SELECT count(*)::int n FROM qarzhy.financial_events
        WHERE organization_id=$1`, [org.id])).rows[0].n, 0);
      await assert.rejects(withTransaction(pool, client => saveLegacyBudget({ client, principal,
        input: { ...input, org: 'Other Budget Org' } })), /forbidden/i);
      await assert.rejects(withTransaction(pool, client => saveLegacyBudget({ client, principal,
        input: { ...input, metric: 'profit' } })), /metric/i);
      await pool.query(`INSERT INTO qarzhy.accounting_periods(organization_id,starts_on,closed)
        VALUES($1,'2033-05-01',true)`, [org.id]);
      await assert.rejects(withTransaction(pool, client => saveLegacyBudget({ client, principal,
        input: { ...input, amount: 2000 } })), /closed period/i);
      assert.equal(other.id !== org.id, true);
    } finally { await pool.end(); }
  });
