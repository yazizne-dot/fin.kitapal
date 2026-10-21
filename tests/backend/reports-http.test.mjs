import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { hashPassword } from '../../backend/auth/passwords.mjs';
import { startApi } from '../../backend/http/server.mjs';
import { registerAccountRoutes } from '../../backend/http/account-routes.mjs';
import { registerReportRoutes } from '../../backend/http/report-routes.mjs';

test('report HTTP routes enforce session and CSRF for figure edits', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  const origin = 'http://127.0.0.1:3000', csrfSecret = 'reports-test-secret-with-enough-entropy';
  const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('reports_http_org','Reports HTTP Org') RETURNING id")).rows[0];
  const scope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [org.id])).rows[0];
  const dataset = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='imported_finance'")).rows[0];
  const metric = (await pool.query("INSERT INTO qarzhy.report_metrics(code,name,unit,calculation_kind) VALUES('http_report_revenue','Revenue','amount','input') RETURNING id")).rows[0];
  const series = (await pool.query(`INSERT INTO qarzhy.historical_series(dataset_id,scope_id,report_family,metric_id)
    VALUES($1,$2,'pnl',$3) RETURNING id`, [dataset.id, scope.id, metric.id])).rows[0];
  await pool.query(`INSERT INTO qarzhy.historical_values(series_id,period_start,period_end,period_kind,value,availability)
    VALUES($1,'2026-08-01','2026-09-01','monthly','100.00','reported')`, [series.id]);
  await pool.query(`INSERT INTO qarzhy.historical_values(series_id,period_start,period_end,period_kind,value,availability)
    VALUES($1,'2026-01-01','2027-01-01','source_ytd','900.00','reported')`, [series.id]);
  const hashed = await hashPassword('reports http private phrase 2026');
  await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,password_salt,password_hash,must_change_password,password_changed_at)
    VALUES('reportshttp','Reports HTTP',(SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2,false,now())`,
  [hashed.password_salt, hashed.password_hash]);
  const api = await startApi({ pool, port: 0, registerRoutes: router => {
    registerAccountRoutes(router, { pool, publicOrigin: origin, csrfSecret });
    registerReportRoutes(router, { pool, publicOrigin: origin, csrfSecret });
  } });
  const base = `http://127.0.0.1:${api.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/reports/figures?dataset_id=${dataset.id}&scope_id=${scope.id}&family=pnl&start=2026-08-01&end=2026-09-01&kind=monthly`)).status, 401);
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'reportshttp', password: 'reports http private phrase 2026' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const csrf = (await (await fetch(`${base}/api/csrf`, { headers: { cookie } })).json()).csrf_token;
    const query = `dataset_id=${dataset.id}&scope_id=${scope.id}&family=pnl&start=2026-08-01&end=2026-09-01&kind=monthly`;
    const figures = await fetch(`${base}/api/reports/figures?${query}`, { headers: { cookie } });
    assert.equal(figures.status, 200);
    const listed = await figures.json();
    assert.equal(listed.rows[0].value, '100.00');
    const key = { datasetId: dataset.id, scopeId: scope.id, reportFamily: 'pnl', metricId: metric.id,
      periodStart: '2026-08-01', periodEnd: '2026-09-01', periodKind: 'monthly' };
    const body = JSON.stringify({ key, value: '120.00', revision: listed.revision, reason: 'Checked against invoice' });
    const bad = await fetch(`${base}/api/reports/figures`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body });
    assert.equal(bad.status, 403);
    const saved = await fetch(`${base}/api/reports/figures`, { method: 'POST',
      headers: { origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf }, body });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).value, '120.00');
    const after = await fetch(`${base}/api/reports/figures?${query}`, { headers: { cookie } });
    assert.equal((await after.json()).rows[0].value, '120.00');
    const editor = await fetch(`${base}/api/finance/editor?book=pnl-history-${scope.id}&sheet=2026-08`, { headers: { cookie } });
    assert.equal(editor.status, 200);
    const current = await editor.json();
    assert.equal(current.rows[0].cell, `${metric.id}:0:0`);
    assert.equal(current.rows[0].value, '120.00');
    assert.ok(current.sheets.includes('2026-YTD'));
    const ytdEditor = await fetch(`${base}/api/finance/editor?book=pnl-history-${scope.id}&sheet=2026-YTD`, { headers: { cookie } });
    assert.equal(ytdEditor.status, 200);
    assert.equal((await ytdEditor.json()).rows[0].value, '900.00');
    const edit = await fetch(`${base}/api/finance/cell`, { method: 'POST',
      headers: { origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ book: current.book, sheet: current.sheet, cell: current.rows[0].cell,
        value: '130.00', reason: 'Second verified correction', revision: current.revision }) });
    assert.equal(edit.status, 200);
    const revised = await fetch(`${base}/api/finance/editor?book=pnl-history-${scope.id}&sheet=2026-08`, { headers: { cookie } });
    assert.equal((await revised.json()).rows[0].value, '130.00');
    const live = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
    await pool.query(`INSERT INTO qarzhy.financial_events
      (dataset_id,scope_id,organization_id,occurred_on,event_kind,amount,posting_key)
      VALUES($1,$2,$3,'2026-08-15','revenue','40.00','http_live_editor')`, [live.id, scope.id, org.id]);
    const liveEditor = await fetch(`${base}/api/finance/editor?book=pnl-live-${scope.id}&sheet=2026-08`, { headers: { cookie } });
    assert.equal(liveEditor.status, 200);
    const liveData = await liveEditor.json();
    const liveRevenue = liveData.rows.find(row => row.label === 'Revenue');
    assert.equal(liveRevenue.original, '40.00');
    const liveEdit = await fetch(`${base}/api/finance/cell`, { method: 'POST',
      headers: { origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ book: liveData.book, sheet: liveData.sheet, cell: liveRevenue.cell,
        value: '55.00', reason: 'Live report correction', revision: liveData.revision }) });
    assert.equal(liveEdit.status, 200);
    const liveRevised = await fetch(`${base}/api/finance/editor?book=pnl-live-${scope.id}&sheet=2026-08`, { headers: { cookie } });
    assert.equal((await liveRevised.json()).rows.find(row => row.label === 'Revenue').value, '55.00');
  } finally { await new Promise(resolve => api.close(resolve)); await pool.end(); }
});
