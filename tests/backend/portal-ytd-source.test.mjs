import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { buildPortalFinanceData } from '../../backend/reports/portal-data.mjs';

test('portal YTD exposes a source-year discrepancy without replacing the monthly calculation',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
    try {
      const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('ytd_source_org','YTD Source Org') RETURNING id")).rows[0];
      const scope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [org.id])).rows[0];
      const dataset = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='imported_finance'")).rows[0];
      const principal = { id: '1', role: 'finance', organization_id: org.id,
        permissions: ['finance.read'], active: true };
      const values = {
        revenue: ['100', '50', '150'], cost: ['0', '0', '0'],
        opex: ['10', '10', '25'], otherExpense: ['0', '0', '0'],
        bonuses: ['0', '0', '0'], otherIncome: ['0', '0', '0'],
        taxes: ['0', '0', '0'], dividends: ['0', '0', '0'],
      };
      let revenueSeries;
      for (const [key, [jan, feb, sourceYtd]] of Object.entries(values)) {
        const series = (await pool.query(`INSERT INTO qarzhy.historical_series
          (dataset_id,scope_id,report_family,metric_id)
          VALUES($1,$2,'pnl',(SELECT id FROM qarzhy.report_metrics WHERE code=$3)) RETURNING id`,
        [dataset.id, scope.id, `live.pnl.${key}`])).rows[0];
        if (key === 'revenue') revenueSeries = series.id;
        await pool.query(`INSERT INTO qarzhy.historical_values
          (series_id,period_start,period_end,period_kind,value,availability)
          VALUES($1,'2039-01-01','2039-02-01','monthly',$2,'reported'),
            ($1,'2039-02-01','2039-03-01','monthly',$3,'reported'),
            ($1,'2039-01-01','2040-01-01','source_ytd',$4,'reported')`,
        [series.id, jan, feb, sourceYtd]);
      }
      await pool.query(`INSERT INTO qarzhy.coverage_rules
        (dataset_id,scope_id,report_family,starts_on,ends_on,source_kind)
        VALUES($1,$2,'pnl','2039-01-01','2039-03-01','historical')`, [dataset.id, scope.id]);
      const ytd = await buildPortalFinanceData({ pool, principal,
        filters: { month: '2039-02', range: 'ytd' } });
      assert.equal(ytd.report.profit, 130);
      assert.deepEqual(ytd.checks.filter(check => check.kind === 'annual-rollup' &&
        check.metric === 'profit').map(check => [check.reported, check.calculated, check.difference]),
      [[125, 130, -5]]);
      await pool.query(`UPDATE qarzhy.historical_values SET value=151
        WHERE series_id=$1 AND period_kind='source_ytd'`, [revenueSeries]);
      const differentCutoff = await buildPortalFinanceData({ pool, principal,
        filters: { month: '2039-02', range: 'ytd' } });
      assert.equal(differentCutoff.checks.some(check => check.kind === 'annual-rollup'), false);
    } finally { await pool.end(); }
  });
