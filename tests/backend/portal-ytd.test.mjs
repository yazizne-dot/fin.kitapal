import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { buildPortalFinanceData } from '../../backend/reports/portal-data.mjs';

test('portal YTD sums only individually covered monthly figures through the latest actual month',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
    try {
      const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('ytd_org','YTD Org') RETURNING id")).rows[0];
      const scope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [org.id])).rows[0];
      const dataset = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
      const principal = { id: '1', name: 'Finance', username: 'finance', role: 'finance',
        organization_id: org.id, active: true, permissions: ['finance.read'] };
      await pool.query(`INSERT INTO qarzhy.financial_events(dataset_id,scope_id,organization_id,occurred_on,event_kind,amount,posting_key)
        VALUES($1,$2,$3,'2038-01-10','revenue',100.10,'ytd-jan'),
          ($1,$2,$3,'2038-02-10','revenue',50.20,'ytd-feb'),
          ($1,$2,$3,'2037-01-10','revenue',40.00,'ytd-prior-jan'),
          ($1,$2,$3,'2037-02-10','revenue',20.00,'ytd-prior-feb')`, [dataset.id, scope.id, org.id]);
      await pool.query(`INSERT INTO qarzhy.coverage_rules(dataset_id,scope_id,report_family,starts_on,ends_on,source_kind)
        VALUES($1,$2,'pnl','2038-02-01','2038-03-01','events'),
          ($1,$2,'pnl','2037-01-01','2037-02-01','events'),
          ($1,$2,'pnl','2037-02-01','2037-03-01','events')`, [dataset.id, scope.id]);
      const missing = await buildPortalFinanceData({ pool, principal,
        filters: { month: '2038-03', range: 'ytd' } });
      assert.equal(missing.range, 'ytd');
      assert.equal(missing.report.revenue, null);
      assert.equal(missing.actualAvailable, false);
      await pool.query(`INSERT INTO qarzhy.coverage_rules(dataset_id,scope_id,report_family,starts_on,ends_on,source_kind)
        VALUES($1,$2,'pnl','2038-01-01','2038-02-01','events')`, [dataset.id, scope.id]);
      const ytd = await buildPortalFinanceData({ pool, principal,
        filters: { month: '2038-03', range: 'ytd' } });
      assert.equal(ytd.actualThrough, '2038-02');
      assert.equal(ytd.aggregation, 'monthly-sum');
      assert.equal(ytd.report.revenue, 150.30);
      assert.equal(ytd.report.profit, 150.30);
      assert.equal(ytd.previous.revenue, 60);
      assert.deepEqual(ytd.history.map(row => row.month), ['2038-01', '2038-02']);
      assert.equal(ytd.report.revenue, 150.30);
    } finally { await pool.end(); }
  });
