import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { getPnlPeriod } from '../../backend/reports/pnl.mjs';
import { getCashflowPeriod } from '../../backend/reports/cashflow.mjs';

test('consolidated reports include organization-scoped live facts once', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const dataset = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
    const consolidated = (await pool.query("SELECT id FROM qarzhy.report_scopes WHERE scope_type='consolidated'")).rows[0];
    const principal = { id: '1', permissions: ['finance.read'] };
    for (const family of ['pnl', 'cashflow']) await pool.query(`INSERT INTO qarzhy.coverage_rules
      (dataset_id,scope_id,report_family,starts_on,ends_on,source_kind)
      VALUES($1,$2,$3,'2030-01-01','2030-02-01',$4)`,
    [dataset.id, consolidated.id, family, family === 'pnl' ? 'events' : 'movements']);
    for (const [index, revenue, cash] of [['one', '10.25', '5.50'], ['two', '20.10', '7.25']]) {
      const org = (await pool.query('INSERT INTO qarzhy.organizations(code,name) VALUES($1,$2) RETURNING id',
        [`consolidated_${index}`, `Consolidated ${index}`])).rows[0];
      const scope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [org.id])).rows[0];
      const account = (await pool.query(`INSERT INTO qarzhy.cash_accounts(organization_id,code,name,account_type)
        VALUES($1,$2,$3,'bank') RETURNING id`, [org.id, `consolidated_account_${index}`, `Account ${index}`])).rows[0];
      await pool.query(`INSERT INTO qarzhy.financial_events(dataset_id,scope_id,organization_id,occurred_on,event_kind,amount,posting_key)
        VALUES($1,$2,$3,'2030-01-15','revenue',$4,$5)`, [dataset.id, scope.id, org.id, revenue, `consolidated_revenue_${index}`]);
      await pool.query(`INSERT INTO qarzhy.cash_movements(dataset_id,scope_id,organization_id,cash_account_id,occurred_on,direction,amount,posting_key)
        VALUES($1,$2,$3,$4,'2030-01-15','in',$5,$6)`,
      [dataset.id, scope.id, org.id, account.id, cash, `consolidated_cash_${index}`]);
    }
    const pnl = await getPnlPeriod({ pool, principal, scopeId: consolidated.id,
      start: '2030-01-01', end: '2030-02-01' });
    const cashflow = await getCashflowPeriod({ pool, principal, scopeId: consolidated.id,
      start: '2030-01-01', end: '2030-02-01' });
    assert.equal(pnl.figures.revenue, '30.35');
    assert.equal(pnl.figures.profit, '30.35');
    assert.equal(pnl.coverage.intervals[0].starts_on, '2030-01-01');
    assert.equal(pnl.coverage.intervals[0].ends_on, '2030-02-01');
    assert.equal(cashflow.totals.inflow, '12.75');
    assert.equal(cashflow.totals.net, '12.75');
    assert.equal(cashflow.rows[0].occurred_on, '2030-01-15');
  } finally { await pool.end(); }
});
