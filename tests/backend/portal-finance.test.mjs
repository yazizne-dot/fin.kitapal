import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { buildPortalFinanceData } from '../../backend/reports/portal-data.mjs';
import { hashPassword } from '../../backend/auth/passwords.mjs';
import { startApi } from '../../backend/http/server.mjs';
import { registerAccountRoutes } from '../../backend/http/account-routes.mjs';
import { registerPortalRoutes } from '../../backend/http/portal-routes.mjs';
import { setReportOverride } from '../../backend/reports/overrides.mjs';
import { withTransaction } from '../../backend/db/connection.mjs';

test('finance portal P&L uses effective PostgreSQL figures and reports missing coverage', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('portal_finance_org','Portal Finance Org') RETURNING id")).rows[0];
    const scope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [org.id])).rows[0];
    const dataset = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
    const principal = { id: '1', role: 'finance', organization_id: org.id, name: 'Finance', username: 'finance',
      language: 'ru', active: true, password_change_due: false, permissions: ['finance.read'] };
    const missing = await buildPortalFinanceData({ pool, principal, filters: { month: '2031-04' } });
    assert.equal(missing.source, 'workbook');
    assert.equal(missing.report.revenue, null);
    assert.equal(missing.actualAvailable, false);
    assert.ok(missing.checks.length);
    await pool.query(`INSERT INTO qarzhy.coverage_rules(dataset_id,scope_id,report_family,starts_on,ends_on,source_kind)
      VALUES($1,$2,'pnl','2031-04-01','2031-05-01','events')`, [dataset.id, scope.id]);
    await pool.query(`INSERT INTO qarzhy.financial_events(dataset_id,scope_id,organization_id,occurred_on,event_kind,amount,posting_key)
      VALUES($1,$2,$3,'2031-04-12','revenue',100.10,'portal-finance-revenue'),
            ($1,$2,$3,'2031-04-12','cost',30.05,'portal-finance-cost')`, [dataset.id, scope.id, org.id]);
    const data = await buildPortalFinanceData({ pool, principal, filters: { month: '2031-04' } });
    assert.equal(data.month, '2031-04');
    assert.equal(data.report.revenue, 100.10);
    assert.equal(data.report.gross, 70.05);
    assert.equal(data.report.profit, 70.05);
    assert.equal(data.actualAvailable, true);
    assert.deepEqual(data.periods, ['2031-04']);
    const account = (await pool.query(`INSERT INTO qarzhy.cash_accounts(organization_id,code,name,account_type)
      VALUES($1,'portal_finance_cash','Portal Finance Cash','bank') RETURNING id`, [org.id])).rows[0];
    const snapshot = (await pool.query(`INSERT INTO qarzhy.balance_snapshots(dataset_id,scope_id,as_of_date,label,status)
      VALUES($1,$2,'2031-04-01','Portal opening','verified') RETURNING id`, [dataset.id, scope.id])).rows[0];
    await pool.query('INSERT INTO qarzhy.cash_balances(snapshot_id,cash_account_id,amount) VALUES($1,$2,50)',
      [snapshot.id, account.id]);
    await pool.query(`INSERT INTO qarzhy.coverage_rules(dataset_id,scope_id,report_family,starts_on,ends_on,source_kind,opening_snapshot_id)
      VALUES($1,$2,'balance','2031-04-01','2031-06-01','opening_and_movements',$3)`, [dataset.id, scope.id, snapshot.id]);
    await pool.query(`INSERT INTO qarzhy.coverage_rules(dataset_id,scope_id,report_family,starts_on,ends_on,source_kind)
      VALUES($1,$2,'cashflow','2031-04-01','2031-05-01','movements')`, [dataset.id, scope.id]);
    await pool.query(`INSERT INTO qarzhy.cash_movements(dataset_id,scope_id,organization_id,cash_account_id,
      occurred_on,direction,amount,posting_key) VALUES($1,$2,$3,$4,'2031-04-15','in',5.25,'portal-finance-cash-in')`,
    [dataset.id, scope.id, org.id, account.id]);
    const withStatements = await buildPortalFinanceData({ pool, principal, filters: { month: '2031-04' } });
    assert.equal(withStatements.statements.balance.rows.find(row => row.id === 'cash').value, 55.25);
    assert.equal(withStatements.statements.balance.rows.find(row => row.id === 'assets').value, null);
    assert.equal(withStatements.statements.cashflow.business.net, 5.25);
    assert.equal(withStatements.statements.cashflow.rows.length, 1);
    const hashed = await hashPassword('portal finance private phrase 2026');
    const financeUser = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,organization_id,password_salt,password_hash,
      must_change_password,password_changed_at) VALUES('portalfinance','Portal Finance',
      (SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2,$3,false,now()) RETURNING id`,
    [org.id, hashed.password_salt, hashed.password_hash])).rows[0];
    const revenueMetric = (await pool.query("SELECT id FROM qarzhy.report_metrics WHERE code='live.pnl.revenue'")).rows[0];
    const revision = (await pool.query('SELECT revision FROM qarzhy.financial_state WHERE singleton=true')).rows[0].revision;
    await withTransaction(pool, client => setReportOverride({ client,
      principal: { ...principal, id: financeUser.id, permissions: ['finance.read', 'finance.write'] },
      key: { datasetId: dataset.id, scopeId: scope.id, reportFamily: 'pnl', periodStart: '2031-04-01',
        periodEnd: '2031-05-01', periodKind: 'monthly', metricId: revenueMetric.id },
      value: '120.10', reason: 'Correct report display', revision }));
    const corrected = await buildPortalFinanceData({ pool, principal, filters: { month: '2031-04' } });
    assert.equal(corrected.report.revenue, 120.10);
    assert.equal(corrected.report.profit, 90.05);
    assert.equal((await pool.query("SELECT sum(amount)::text AS value FROM qarzhy.financial_events WHERE posting_key='portal-finance-revenue'")).rows[0].value, '100.10');
    await pool.query(`INSERT INTO qarzhy.coverage_rules(dataset_id,scope_id,report_family,starts_on,ends_on,source_kind)
      VALUES($1,$2,'budget','2031-04-01','2031-05-01','budget')`, [dataset.id, scope.id]);
    const version = (await pool.query(`INSERT INTO qarzhy.budget_versions(scope_id,year,name,status,approved_by,approved_at)
      VALUES($1,2031,'Approved plan','approved',$2,now()) RETURNING id`, [scope.id, financeUser.id])).rows[0];
    await pool.query(`INSERT INTO qarzhy.budget_items(budget_version_id,month,metric_id,amount)
      VALUES($1,'2031-04-01',(SELECT id FROM qarzhy.report_metrics WHERE code='live.pnl.opex'),20.00)`, [version.id]);
    await pool.query(`INSERT INTO qarzhy.budget_items(budget_version_id,month,metric_id,amount)
      VALUES($1,'2031-05-01',(SELECT id FROM qarzhy.report_metrics WHERE code='live.pnl.opex'),25.00)`, [version.id]);
    const article = (await pool.query("INSERT INTO qarzhy.financial_articles(code,name) VALUES('portal_budget_article','Budget Article') RETURNING id")).rows[0];
    await pool.query(`INSERT INTO qarzhy.budget_items(budget_version_id,month,metric_id,article_id,amount)
      VALUES($1,'2031-04-01',(SELECT id FROM qarzhy.report_metrics WHERE code='live.pnl.opex'),$2,5.00)`,
    [version.id, article.id]);
    await pool.query(`INSERT INTO qarzhy.budget_versions(scope_id,year,name,status)
      VALUES($1,2031,'Unapproved changes','draft')`, [scope.id]);
    const budgeted = await buildPortalFinanceData({ pool, principal, filters: { month: '2031-04' } });
    const opexBudget = budgeted.budgetRows.find(row => row.label === 'ИТОГО ОПЕРАЦИОННЫЕ РАСХОДЫ');
    assert.equal(opexBudget.plan, 20);
    assert.equal(opexBudget.actual, 0);
    assert.equal(budgeted.budgetTimeline[0].plan, 20);
    assert.deepEqual(budgeted.periods, ['2031-04', '2031-05']);
    assert.equal(budgeted.budgetRows.find(row => row.label.includes('Budget Article')).actual, null);
    assert.match(budgeted.checks.map(row => row.title).join(' '), /matching rule/i);
    const origin = 'http://127.0.0.1:3000';
    const api = await startApi({ pool, port: 0, registerRoutes: router => {
      registerAccountRoutes(router, { pool, publicOrigin: origin, csrfSecret: 'portal-finance-test-secret-32bytes' });
      registerPortalRoutes(router, { pool });
    } });
    try {
      const base = `http://127.0.0.1:${api.address().port}`;
      const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'portalfinance', password: 'portal finance private phrase 2026' }) });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const response = await fetch(`${base}/api/data?month=2031-04`, { headers: { cookie } });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).report.profit, 90.05);
      assert.equal((await fetch(`${base}/api/data?month=2031-04&source=ledger`, { headers: { cookie } })).status, 503);
    } finally { await new Promise(resolve => api.close(resolve)); }
  } finally { await pool.end(); }
});
