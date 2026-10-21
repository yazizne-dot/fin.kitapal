import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { withTransaction } from '../../backend/db/connection.mjs';
import { saveCoverage } from '../../backend/reports/coverage.mjs';
import { getPnlPeriod } from '../../backend/reports/pnl.mjs';
import { listEditableFigures } from '../../backend/reports/overrides.mjs';

test('P&L chooses historical or live coverage once and keeps source YTD separate', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('report_calc_org','Report Calc Org') RETURNING id")).rows[0];
    const scope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [org.id])).rows[0];
    const datasets = (await pool.query('SELECT id,kind FROM qarzhy.datasets')).rows;
    const historical = datasets.find(row => row.kind === 'imported_finance');
    const live = datasets.find(row => row.kind === 'live');
    const user = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,password_salt,password_hash)
      VALUES('reportcalcfinance','Report Calc Finance',(SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2) RETURNING id`,
      ['0'.repeat(32), '0'.repeat(128)])).rows[0];
    const principal = { id: user.id, name: 'Report Calc Finance', permissions: ['finance.read', 'finance.write'] };
    for (const [start, end, dataset, sourceKind] of [
      ['2026-10-01', '2026-11-01', historical, 'historical'],
      ['2026-11-01', '2026-12-01', live, 'events'],
    ]) await withTransaction(pool, client => saveCoverage({ client, principal, input: {
      datasetId: dataset.id, scopeId: scope.id, family: 'pnl', start, end, sourceKind,
    } }));

    const figures = { revenue: '100.00', cost: '30.00', gross: '70.00', opex: '10.00', otherExpense: '3.00',
      bonuses: '2.00', otherIncome: '0.00', taxes: '5.00', dividends: '4.00' };
    let revenueMetricId;
    for (const [code, value] of Object.entries(figures)) {
      const metric = (await pool.query(`INSERT INTO qarzhy.report_metrics(code,name,unit,calculation_kind)
        VALUES($1,$1,'amount','input') RETURNING id`, [code])).rows[0];
      if (code === 'revenue') revenueMetricId = metric.id;
      const series = (await pool.query(`INSERT INTO qarzhy.historical_series(dataset_id,scope_id,report_family,metric_id)
        VALUES($1,$2,'pnl',$3) RETURNING id`, [historical.id, scope.id, metric.id])).rows[0];
      await pool.query(`INSERT INTO qarzhy.historical_values(series_id,period_start,period_end,period_kind,value,availability)
        VALUES($1,'2026-10-01','2026-11-01','monthly',$2,'reported')`, [series.id, value]);
      if (code === 'revenue') await pool.query(`INSERT INTO qarzhy.historical_values
        (series_id,period_start,period_end,period_kind,value,availability)
        VALUES($1,'2026-01-01','2027-01-01','source_ytd','900.00','reported')`, [series.id]);
    }
    await pool.query(`INSERT INTO qarzhy.financial_events
      (dataset_id,scope_id,organization_id,occurred_on,event_kind,amount,posting_key)
      VALUES($1,$2,$3,'2026-10-15','revenue',999,'report_calc_overlap')`, [live.id, scope.id, org.id]);
    for (const [kind, amount] of [['revenue', '200.00'], ['cost', '40.00'], ['opex', '20.00'],
      ['other_expense', '4.00'], ['bonus', '3.00'], ['other_income', '1.00'], ['tax', '6.00'], ['dividend', '5.00']]) {
      await pool.query(`INSERT INTO qarzhy.financial_events
        (dataset_id,scope_id,organization_id,occurred_on,event_kind,amount,posting_key)
        VALUES($1,$2,$3,'2026-11-15',$4,$5,$6)`, [live.id, scope.id, org.id, kind, amount, `report_calc_${kind}`]);
    }

    const october = await getPnlPeriod({ pool, principal, scopeId: scope.id, start: '2026-10-01', end: '2026-11-01' });
    assert.equal(october.source, 'historical');
    assert.equal(october.figures.revenue, '100.00');
    assert.equal(october.figures.profit, '50.00');
    assert.equal(october.complete, true);
    const factsBefore = (await pool.query(`SELECT
      (SELECT count(*) FROM qarzhy.financial_events WHERE scope_id=$1) AS events,
      (SELECT count(*) FROM qarzhy.cash_movements WHERE scope_id=$1) AS movements,
      (SELECT count(*) FROM qarzhy.documents WHERE organization_id=$2) AS documents`, [scope.id, org.id])).rows[0];
    await pool.query(`INSERT INTO qarzhy.report_overrides
      (dataset_id,report_family,scope_id,period_start,period_end,period_kind,metric_id,source_value,value,revision,updated_by)
      VALUES($1,'pnl',$2,'2026-10-01','2026-11-01','monthly',$3,'100.00','120.00',1,$4)`,
    [historical.id, scope.id, revenueMetricId, user.id]);
    const corrected = await getPnlPeriod({ pool, principal, scopeId: scope.id, start: '2026-10-01', end: '2026-11-01' });
    assert.equal(corrected.figures.revenue, '120.00');
    assert.equal(corrected.figures.profit, '70.00');
    const editable = await listEditableFigures({ pool, principal, filters: { datasetId: historical.id,
      scopeId: scope.id, reportFamily: 'pnl', periodStart: '2026-10-01', periodEnd: '2026-11-01',
      periodKind: 'monthly' } });
    const grossRow = editable.rows.find(row => row.label === 'gross');
    assert.equal(grossRow.original, '70.00');
    assert.equal(grossRow.value, '90.00');
    assert.equal(grossRow.recalculated, true);
    const factsAfter = (await pool.query(`SELECT
      (SELECT count(*) FROM qarzhy.financial_events WHERE scope_id=$1) AS events,
      (SELECT count(*) FROM qarzhy.cash_movements WHERE scope_id=$1) AS movements,
      (SELECT count(*) FROM qarzhy.documents WHERE organization_id=$2) AS documents`, [scope.id, org.id])).rows[0];
    assert.deepEqual(factsAfter, factsBefore);
    const november = await getPnlPeriod({ pool, principal, scopeId: scope.id, start: '2026-11-01', end: '2026-12-01' });
    assert.equal(november.source, 'events');
    assert.equal(november.figures.revenue, '200.00');
    assert.equal(november.figures.profit, '128.00');
    assert.equal(november.figures.retained, '123.00');
    const ytd = await getPnlPeriod({ pool, principal, scopeId: scope.id,
      start: '2026-01-01', end: '2027-01-01', periodKind: 'source_ytd', source: 'historical' });
    assert.equal(ytd.figures.revenue, '900.00');
    assert.equal(ytd.figures.profit, null);
    assert.equal(ytd.complete, false);
    assert.match(ytd.warnings.join(' '), /missing/i);
    const gap = await getPnlPeriod({ pool, principal, scopeId: scope.id, start: '2026-12-01', end: '2027-01-01' });
    assert.equal(gap.complete, false);
    assert.equal(gap.figures.profit, null);
  } finally { await pool.end(); }
});
