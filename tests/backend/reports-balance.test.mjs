import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { getBalanceAt } from '../../backend/reports/balance.mjs';

test('balance requires verified opening snapshot and calculates cash without changing movements', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('balance_org','Balance Org') RETURNING id")).rows[0];
    const scope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [org.id])).rows[0];
    const dataset = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
    const principal = { id: '1', permissions: ['finance.read'] };
    const absent = await getBalanceAt({ pool, principal, scopeId: scope.id, asOf: '2027-01-01' });
    assert.equal(absent.totals.cash, null);
    assert.equal(absent.complete, false);
    const snapshot = (await pool.query(`INSERT INTO qarzhy.balance_snapshots(dataset_id,scope_id,as_of_date,label,status)
      VALUES($1,$2,'2026-12-01','Opening','draft') RETURNING id`, [dataset.id, scope.id])).rows[0];
    const account = (await pool.query(`INSERT INTO qarzhy.cash_accounts(organization_id,code,name,account_type)
      VALUES($1,'balance_account','Balance Account','bank') RETURNING id`, [org.id])).rows[0];
    await pool.query('INSERT INTO qarzhy.cash_balances(snapshot_id,cash_account_id,amount) VALUES($1,$2,100.10)', [snapshot.id, account.id]);
    const draft = await getBalanceAt({ pool, principal, scopeId: scope.id, asOf: '2027-01-01', source: 'opening_and_movements' });
    assert.equal(draft.totals.cash, null);
    await pool.query("UPDATE qarzhy.balance_snapshots SET status='verified' WHERE id=$1", [snapshot.id]);
    await pool.query(`INSERT INTO qarzhy.coverage_rules(dataset_id,scope_id,report_family,starts_on,ends_on,source_kind,opening_snapshot_id)
      VALUES($1,$2,'balance','2026-12-01','2027-02-01','opening_and_movements',$3)`, [dataset.id, scope.id, snapshot.id]);
    await pool.query(`INSERT INTO qarzhy.cash_movements(dataset_id,scope_id,organization_id,cash_account_id,occurred_on,direction,amount,posting_key)
      VALUES($1,$2,$3,$4,'2026-12-12','in',10.25,'balance-in'),
            ($1,$2,$3,$4,'2026-12-13','out',4.00,'balance-out')`, [dataset.id, scope.id, org.id, account.id]);
    const result = await getBalanceAt({ pool, principal, scopeId: scope.id, asOf: '2027-01-01' });
    assert.equal(result.source, 'opening_and_movements');
    assert.equal(result.totals.cash, '106.35');
    assert.equal(result.totals.assets, null);
    assert.equal(result.complete, false);
    assert.match(result.warnings.join(' '), /inventory|asset/i);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM qarzhy.cash_movements WHERE posting_key IN ('balance-in','balance-out')")).rows[0].n, 2);
  } finally { await pool.end(); }
});
