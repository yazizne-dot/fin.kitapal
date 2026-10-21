import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { withTransaction } from '../../backend/db/connection.mjs';
import { savePlan, saveBudgetItem, setPeriodClosed } from '../../backend/finance/planning.mjs';
import { assertOpenPeriod } from '../../backend/finance/validation.mjs';

test('plans and budgets are separate from facts and reject changes in closed periods', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('planning_org','Planning Org') RETURNING id")).rows[0];
    const scope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [org.id])).rows[0];
    const article = (await pool.query("INSERT INTO qarzhy.financial_articles(code,name) VALUES('planning_article','Planning article') RETURNING id")).rows[0];
    const metric = (await pool.query("INSERT INTO qarzhy.report_metrics(code,name,unit,calculation_kind) VALUES('planning_metric','Planning metric','amount','input') RETURNING id")).rows[0];
    const user = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,password_salt,password_hash)
      VALUES('planningfinance','Planning Finance',(SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2) RETURNING id`, ['0'.repeat(32), '0'.repeat(128)])).rows[0];
    const principal = { id: user.id, name: 'Planning Finance', permissions: ['finance.write'] };
    const budget = (await pool.query("INSERT INTO qarzhy.budget_versions(scope_id,year,name,created_by) VALUES($1,2026,'Test budget',$2) RETURNING id", [scope.id, user.id])).rows[0];
    const plan = await withTransaction(pool, client => savePlan({ client, principal, input: {
      organizationId: org.id, articleId: article.id, date: '2026-12-10', direction: 'out', amount: '150.00',
    } }));
    assert.equal(plan.amount, '150.00');
    const item = await withTransaction(pool, client => saveBudgetItem({ client, principal, input: {
      budgetVersionId: budget.id, month: '2026-12-01', metricId: metric.id, amount: '1000.00',
    } }));
    assert.equal(item.amount, '1000.00');
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM qarzhy.financial_events WHERE organization_id=$1', [org.id])).rows[0].n, 0);
    await withTransaction(pool, client => setPeriodClosed({ client, principal, organizationId: org.id,
      month: '2026-12', closed: true, reason: 'Month finalized' }));
    await assert.rejects(withTransaction(pool, client => savePlan({ client, principal, input: {
      organizationId: org.id, articleId: article.id, date: '2026-12-11', direction: 'out', amount: '15.00',
    } })), /closed period/i);
    await assert.rejects(withTransaction(pool, client => saveBudgetItem({ client, principal, input: {
      budgetVersionId: budget.id, month: '2026-12-01', metricId: metric.id, amount: '1100.00',
    } })), /closed period/i);
    await assert.rejects(withTransaction(pool, client => setPeriodClosed({ client, principal,
      organizationId: org.id, month: '2026-12', closed: false, reason: '' })), /reason/i);
    await withTransaction(pool, client => setPeriodClosed({ client, principal, organizationId: org.id,
      month: '2026-12', closed: false, reason: 'Correction approved' }));
    assert.equal((await pool.query("SELECT closed FROM qarzhy.accounting_periods WHERE organization_id=$1 AND starts_on='2026-12-01'", [org.id])).rows[0].closed, false);
  } finally { await pool.end(); }
});

test('closing an absent period waits for a writer checking that month', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  const first = await pool.connect(), second = await pool.connect();
  let closing;
  try {
    const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('period_lock_org','Period Lock Org') RETURNING id")).rows[0];
    const user = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,password_salt,password_hash)
      VALUES('periodlockfinance','Period Lock Finance',(SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2) RETURNING id`,
      ['0'.repeat(32), '0'.repeat(128)])).rows[0];
    const principal = { id: user.id, name: 'Period Lock Finance', permissions: ['finance.write'] };
    await first.query('BEGIN');
    await second.query('BEGIN');
    await assertOpenPeriod(first, org.id, '2026-09-15');
    closing = setPeriodClosed({ client: second, principal, organizationId: org.id,
      month: '2026-09', closed: true, reason: 'Close after pending writer' });
    const state = await Promise.race([closing.then(() => 'closed'),
      new Promise(resolve => setTimeout(() => resolve('waiting'), 100))]);
    assert.equal(state, 'waiting');
    await first.query('COMMIT');
    await closing;
    await second.query('COMMIT');
    await assert.rejects(withTransaction(pool, client => assertOpenPeriod(client, org.id, '2026-09-15')), /closed period/i);
  } finally {
    await first.query('ROLLBACK').catch(() => {});
    await closing?.catch(() => {});
    await second.query('ROLLBACK').catch(() => {});
    first.release(); second.release(); await pool.end();
  }
});
