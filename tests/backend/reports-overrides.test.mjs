import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { withTransaction } from '../../backend/db/connection.mjs';
import { setReportOverride, resetReportOverride, listEditableFigures } from '../../backend/reports/overrides.mjs';
import { calculatePnl } from '../../backend/reports/pnl.mjs';
import { getPnlPeriod } from '../../backend/reports/pnl.mjs';

test('revenue override changes dependent profit with exact decimals and leaves missing data missing', () => {
  const base = { revenue: '100.00', cost: '30.00', opex: '10.00', otherExpense: '3.00',
    bonuses: '2.00', otherIncome: '0.00', taxes: '5.00', dividends: '4.00' };
  const result = calculatePnl(base, { revenue: '120.00' });
  assert.equal(result.gross, '90.00');
  assert.equal(result.profit, '70.00');
  assert.equal(result.retained, '66.00');
  assert.equal(result.reconciliation.gross, null);
  assert.equal(calculatePnl({ ...base, cost: null }, {}).gross, null);
  const explicit = calculatePnl(base, { revenue: '120.00', gross: '88.00' });
  assert.equal(explicit.gross, '88.00');
  assert.equal(explicit.profit, '68.00');
  assert.equal(explicit.reconciliation.gross, '-2.00');
});

test('live P&L figures are editable and recalculate profit without changing the event', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('override_live_org','Override Live Org') RETURNING id")).rows[0];
    const scope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [org.id])).rows[0];
    const live = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
    const user = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,password_salt,password_hash)
      VALUES('overridelive','Override Live',(SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2) RETURNING id`,
      ['0'.repeat(32), '0'.repeat(128)])).rows[0];
    const principal = { id: user.id, name: 'Override Live', permissions: ['finance.read', 'finance.write'], organization_id: org.id };
    await pool.query(`INSERT INTO qarzhy.financial_events
      (dataset_id,scope_id,organization_id,occurred_on,event_kind,amount,posting_key)
      VALUES($1,$2,$3,'2026-12-15','revenue','100.00','override_live_revenue')`, [live.id, scope.id, org.id]);
    const filters = { datasetId: live.id, scopeId: scope.id, reportFamily: 'pnl',
      periodStart: '2026-12-01', periodEnd: '2027-01-01', periodKind: 'monthly' };
    const before = await listEditableFigures({ pool, principal, filters });
    const revenue = before.rows.find(row => row.key === 'revenue');
    assert.equal(revenue.original, '100.00');
    const key = { ...filters, metricId: revenue.metric_id };
    const saved = await withTransaction(pool, client => setReportOverride({ client, principal, key,
      value: '120.00', reason: 'Confirmed report correction', revision: before.revision }));
    assert.equal(saved.source_value, '100.00');
    const result = await getPnlPeriod({ pool, principal, scopeId: scope.id,
      start: '2026-12-01', end: '2027-01-01', source: 'events' });
    assert.equal(result.figures.revenue, '120.00');
    assert.equal(result.figures.profit, '120.00');
    assert.equal((await pool.query("SELECT amount::text FROM qarzhy.financial_events WHERE posting_key='override_live_revenue'")).rows[0].amount, '100.00');
    const gross = before.rows.find(row => row.key === 'gross');
    const grossKey = { ...filters, metricId: gross.metric_id };
    const grossSaved = await withTransaction(pool, client => setReportOverride({ client, principal, key: grossKey,
      value: '50.00', reason: 'Approved gross correction', revision: saved.revision }));
    const reconciled = await getPnlPeriod({ pool, principal, scopeId: scope.id,
      start: '2026-12-01', end: '2027-01-01', source: 'events' });
    assert.equal(reconciled.figures.gross, '50.00');
    assert.equal(reconciled.figures.profit, '50.00');
    assert.equal(reconciled.figures.reconciliation.gross, '-70.00');
    const grossReset = await withTransaction(pool, client => resetReportOverride({ client, principal, key: grossKey,
      reason: 'Restore calculated gross', revision: grossSaved.revision }));
    await withTransaction(pool, client => resetReportOverride({ client, principal, key,
      reason: 'Restore event figure', revision: grossReset.revision }));
    const restored = await getPnlPeriod({ pool, principal, scopeId: scope.id,
      start: '2026-12-01', end: '2027-01-01', source: 'events' });
    assert.equal(restored.figures.profit, '100.00');
  } finally { await pool.end(); }
});

test('keyed report override is reversible with history while historical and cash facts stay unchanged', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const dataset = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='imported_finance'")).rows[0];
    const scope = (await pool.query("SELECT id FROM qarzhy.report_scopes WHERE scope_type='consolidated'")).rows[0];
    const metric = (await pool.query("INSERT INTO qarzhy.report_metrics(code,name,unit,calculation_kind) VALUES('override_revenue','Revenue','amount','input') RETURNING id")).rows[0];
    const series = (await pool.query(`INSERT INTO qarzhy.historical_series(dataset_id,scope_id,report_family,metric_id)
      VALUES($1,$2,'pnl',$3) RETURNING id`, [dataset.id, scope.id, metric.id])).rows[0];
    await pool.query(`INSERT INTO qarzhy.historical_values(series_id,period_start,period_end,period_kind,value,availability)
      VALUES($1,'2026-08-01','2026-09-01','monthly','100.00','reported')`, [series.id]);
    const user = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,password_salt,password_hash)
      VALUES('overridefinance','Override Finance',(SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2) RETURNING id`,
      ['0'.repeat(32), '0'.repeat(128)])).rows[0];
    const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('override_cash_org','Override Cash Org') RETURNING id")).rows[0];
    const cashScope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [org.id])).rows[0];
    const account = (await pool.query(`INSERT INTO qarzhy.cash_accounts(organization_id,code,name,account_type)
      VALUES($1,'override_cash','Override Cash','bank') RETURNING id`, [org.id])).rows[0];
    const live = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
    const cash = (await pool.query(`INSERT INTO qarzhy.cash_movements
      (dataset_id,scope_id,organization_id,cash_account_id,occurred_on,direction,amount,posting_key)
      VALUES($1,$2,$3,$4,'2026-08-15','in','47.25','override_cash_proof') RETURNING id`,
    [live.id, cashScope.id, org.id, account.id])).rows[0];
    const principal = { id: user.id, name: 'Override Finance', permissions: ['finance.write'] };
    const key = { datasetId: dataset.id, scopeId: scope.id, reportFamily: 'pnl', metricId: metric.id,
      periodStart: '2026-08-01', periodEnd: '2026-09-01', periodKind: 'monthly' };
    const foreignPrincipal = { ...principal, organization_id: '999999', permissions: ['finance.write', 'finance.read'] };
    await assert.rejects(listEditableFigures({ pool, principal: foreignPrincipal, filters: {
      datasetId: dataset.id, scopeId: scope.id, reportFamily: 'pnl', periodStart: '2026-08-01',
      periodEnd: '2026-09-01', periodKind: 'monthly',
    } }), /forbidden/i);
    await assert.rejects(withTransaction(pool, client => setReportOverride({ client, principal: foreignPrincipal, key,
      value: '120.00', reason: 'Not my organization', revision: 0 })), /forbidden/i);
    const revision = Number((await pool.query('SELECT revision FROM qarzhy.financial_state WHERE singleton=true')).rows[0].revision);
    const saved = await withTransaction(pool, client => setReportOverride({ client, principal, key,
      value: '120.00', reason: 'Verified sales correction', revision }));
    assert.equal(saved.revision, revision + 1);
    await assert.rejects(withTransaction(pool, client => setReportOverride({ client, principal, key,
      value: '130.00', reason: 'Stale edit', revision })), /revision|conflict/i);
    assert.equal((await pool.query('SELECT value::text FROM qarzhy.historical_values WHERE series_id=$1', [series.id])).rows[0].value, '100.00');
    assert.equal((await pool.query('SELECT amount::text FROM qarzhy.cash_movements WHERE id=$1', [cash.id])).rows[0].amount, '47.25');
    const reset = await withTransaction(pool, client => resetReportOverride({ client, principal, key,
      reason: 'Restore source value', revision: saved.revision }));
    assert.equal(reset.revision, saved.revision + 1);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM qarzhy.report_overrides WHERE scope_id=$1', [scope.id])).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM qarzhy.report_override_history WHERE scope_id=$1', [scope.id])).rows[0].n, 2);
    assert.equal((await pool.query('SELECT amount::text FROM qarzhy.cash_movements WHERE id=$1', [cash.id])).rows[0].amount, '47.25');
  } finally { await pool.end(); }
});
