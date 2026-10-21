import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { withTransaction } from '../../backend/db/connection.mjs';
import { getCoverage, saveCoverage, verifyOpeningSnapshot } from '../../backend/reports/coverage.mjs';

test('coverage separates historical and live intervals and reports unconfigured gaps', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('coverage_org','Coverage Org') RETURNING id")).rows[0];
    const scope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [org.id])).rows[0];
    const dataset = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
    const historical = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='imported_finance'")).rows[0];
    const user = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,password_salt,password_hash)
      VALUES('coveragefinance','Coverage Finance',(SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2) RETURNING id`,
      ['0'.repeat(32), '0'.repeat(128)])).rows[0];
    const principal = { id: user.id, name: 'Coverage Finance', permissions: ['finance.write', 'finance.read'] };
    await assert.rejects(getCoverage({ pool, principal: { ...principal, organization_id: '999999' },
      family: 'pnl', scopeId: scope.id, start: '2026-10-01', end: '2026-11-01' }), /forbidden/i);
    await withTransaction(pool, client => saveCoverage({ client, principal, input: { datasetId: historical.id, scopeId: scope.id,
      family: 'pnl', start: '2026-10-01', end: '2026-11-01', sourceKind: 'historical' } }));
    const gap = await getCoverage({ pool, principal, family: 'pnl', scopeId: scope.id, start: '2026-10-01', end: '2027-01-01' });
    assert.equal(gap.intervals.length, 1);
    assert.deepEqual(gap.gaps, [{ start: '2026-11-01', end: '2027-01-01' }]);
    await withTransaction(pool, client => saveCoverage({ client, principal, input: { datasetId: dataset.id, scopeId: scope.id,
      family: 'pnl', start: '2026-11-01', end: '2027-01-01', sourceKind: 'events' } }));
    const complete = await getCoverage({ pool, principal, family: 'pnl', scopeId: scope.id, start: '2026-10-01', end: '2027-01-01' });
    assert.deepEqual(complete.gaps, []);
    assert.equal(complete.intervals[0].source_kind, 'historical');
    assert.equal(complete.intervals[1].source_kind, 'events');
  } finally { await pool.end(); }
});

test('balance cutover refuses a draft opening snapshot and accepts verified matching date', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const scope = (await pool.query("SELECT id FROM qarzhy.report_scopes WHERE scope_type='organization' AND organization_id=(SELECT id FROM qarzhy.organizations WHERE code='coverage_org')")).rows[0];
    const dataset = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
    const user = (await pool.query("SELECT id FROM qarzhy.users WHERE username='coveragefinance'")).rows[0];
    const principal = { id: user.id, name: 'Coverage Finance', permissions: ['finance.write'] };
    const snapshot = (await pool.query(`INSERT INTO qarzhy.balance_snapshots(dataset_id,scope_id,as_of_date,label,created_by)
      VALUES($1,$2,'2026-11-01','Opening',$3) RETURNING id,version`, [dataset.id, scope.id, user.id])).rows[0];
    await assert.rejects(withTransaction(pool, client => saveCoverage({ client, principal, input: {
      datasetId: dataset.id, scopeId: scope.id, family: 'balance', start: '2026-11-01', end: '2027-01-01',
      sourceKind: 'opening_and_movements', openingSnapshotId: snapshot.id,
    } })), /snapshot|verified/i);
    const account = (await pool.query(`INSERT INTO qarzhy.cash_accounts(organization_id,code,name,account_type)
      VALUES((SELECT organization_id FROM qarzhy.report_scopes WHERE id=$1),'coverage_cash','Coverage Cash','bank') RETURNING id`, [scope.id])).rows[0];
    await pool.query('INSERT INTO qarzhy.cash_balances(snapshot_id,cash_account_id,amount) VALUES($1,$2,100)', [snapshot.id, account.id]);
    await withTransaction(pool, client => verifyOpeningSnapshot({ client, principal, id: snapshot.id, version: snapshot.version }));
    const rule = await withTransaction(pool, client => saveCoverage({ client, principal, input: {
      datasetId: dataset.id, scopeId: scope.id, family: 'balance', start: '2026-11-01', end: '2027-01-01',
      sourceKind: 'opening_and_movements', openingSnapshotId: snapshot.id,
    } }));
    assert.equal(String(rule.opening_snapshot_id), String(snapshot.id));
  } finally { await pool.end(); }
});
