import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { buildPortalFinanceData } from '../../backend/reports/portal-data.mjs';

test('finance portal skips zero-only historical placeholders unless their month has coverage',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
    try {
      const org = (await pool.query(`INSERT INTO qarzhy.organizations(code,name)
        VALUES('month_selection_org','Month selection org') RETURNING id`)).rows[0];
      const scope = (await pool.query(`INSERT INTO qarzhy.report_scopes(scope_type,organization_id)
        VALUES('organization',$1) RETURNING id`, [org.id])).rows[0];
      const dataset = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='imported_finance'")).rows[0];
      const metric = (await pool.query(`INSERT INTO qarzhy.report_metrics(code,name,unit,calculation_kind)
        VALUES('month_selection_revenue','Month selection revenue','amount','input') RETURNING id`)).rows[0];
      const series = (await pool.query(`INSERT INTO qarzhy.historical_series
        (dataset_id,scope_id,report_family,metric_id) VALUES($1,$2,'pnl',$3) RETURNING id`,
      [dataset.id, scope.id, metric.id])).rows[0];
      for (const [start, end, value] of [
        ['2026-08-01', '2026-09-01', '100'],
        ['2026-09-01', '2026-10-01', '0'],
        ['2026-12-01', '2027-01-01', '0'],
      ]) await pool.query(`INSERT INTO qarzhy.historical_values
        (series_id,period_start,period_end,period_kind,value,availability)
        VALUES($1,$2,$3,'monthly',$4,'reported')`, [series.id, start, end, value]);
      const principal = { id: '1', role: 'finance', organization_id: org.id, name: 'Finance',
        username: 'finance', language: 'ru', active: true, permissions: ['finance.read'] };
      const initial = await buildPortalFinanceData({ pool, principal });
      assert.equal(initial.month, '2026-08');
      assert.equal(initial.latest, '2026-08');
      assert.deepEqual(initial.periods, ['2026-08']);

      await pool.query(`INSERT INTO qarzhy.coverage_rules
        (dataset_id,scope_id,report_family,starts_on,ends_on,source_kind)
        VALUES($1,$2,'pnl','2026-12-01','2027-01-01','historical')`, [dataset.id, scope.id]);
      const covered = await buildPortalFinanceData({ pool, principal });
      assert.equal(covered.month, '2026-12');
      assert.equal(covered.latest, '2026-12');
      assert.deepEqual(covered.periods, ['2026-08', '2026-12']);
    } finally { await pool.end(); }
  });
