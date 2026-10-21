import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { withTransaction } from '../../backend/db/connection.mjs';
import { saveCoverage } from '../../backend/reports/coverage.mjs';
import { getCashflowPeriod } from '../../backend/reports/cashflow.mjs';

test('cash flow excludes transfers and leaves unmapped imported money explicit', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('cashflow_org','Cashflow Org') RETURNING id")).rows[0];
    const scope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [org.id])).rows[0];
    const consolidated = (await pool.query("SELECT id FROM qarzhy.report_scopes WHERE scope_type='consolidated'")).rows[0];
    const live = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
    const ledger = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='legacy_ledger'")).rows[0];
    const user = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,password_salt,password_hash)
      VALUES('cashflowfinance','Cashflow Finance',(SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2) RETURNING id`,
    ['0'.repeat(32), '0'.repeat(128)])).rows[0];
    const principal = { id: user.id, name: 'Cashflow Finance', permissions: ['finance.read', 'finance.write'] };
    await withTransaction(pool, client => saveCoverage({ client, principal, input: {
      datasetId: live.id, scopeId: scope.id, family: 'cashflow', start: '2026-11-01',
      end: '2026-12-01', sourceKind: 'movements',
    } }));
    const account = (await pool.query(`INSERT INTO qarzhy.cash_accounts(organization_id,code,name,account_type)
      VALUES($1,'cashflow_account','Cashflow Account','bank') RETURNING id`, [org.id])).rows[0];
    const secondAccount = (await pool.query(`INSERT INTO qarzhy.cash_accounts(organization_id,code,name,account_type)
      VALUES($1,'cashflow_second','Cashflow Second','bank') RETURNING id`, [org.id])).rows[0];
    async function movement(dataset, selectedScope, organization, cashAccount, direction, amount, postingKey, batch = null) {
      return (await pool.query(`INSERT INTO qarzhy.cash_movements
        (dataset_id,scope_id,organization_id,cash_account_id,occurred_on,direction,amount,posting_key,import_batch_id,external_key)
        VALUES($1,$2,$3,$4,'2026-11-15',$5,$6,$7,$8,$9) RETURNING id`,
      [dataset.id, selectedScope.id, organization, cashAccount, direction, amount, postingKey, batch,
        batch ? postingKey : null])).rows[0];
    }
    await movement(live, scope, org.id, account.id, 'in', '10.25', 'cashflow_in');
    await movement(live, scope, org.id, account.id, 'out', '4.00', 'cashflow_out');
    const transferOut = await movement(live, scope, org.id, account.id, 'out', '3.00', 'cashflow_transfer_out');
    const transferIn = await movement(live, scope, org.id, secondAccount.id, 'in', '3.00', 'cashflow_transfer_in');
    await pool.query('INSERT INTO qarzhy.cash_transfers(outgoing_id,incoming_id) VALUES($1,$2)', [transferOut.id, transferIn.id]);
    const current = await getCashflowPeriod({ pool, principal, scopeId: scope.id,
      start: '2026-11-01', end: '2026-12-01' });
    assert.equal(current.source, 'movements');
    assert.deepEqual(current.totals, { inflow: '10.25', outflow: '4.00', net: '6.25' });
    const batch = (await pool.query("INSERT INTO qarzhy.import_batches(fingerprint) VALUES('cashflow-unknown-import') RETURNING id")).rows[0];
    await movement(ledger, consolidated, null, null, 'in', '25.00', 'cashflow_import_unknown', batch.id);
    const imported = await getCashflowPeriod({ pool, principal, scopeId: consolidated.id,
      start: '2026-11-01', end: '2026-12-01', source: 'ledger' });
    assert.equal(imported.totals.inflow, '25.00');
    assert.equal(imported.rows[0].organization_id, null);
    assert.equal(imported.rows[0].cash_account_id, null);
    assert.equal(imported.complete, false);
    assert.match(imported.warnings.join(' '), /unmapped/i);
  } finally { await pool.end(); }
});
