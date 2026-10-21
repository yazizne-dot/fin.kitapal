import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { withTransaction } from '../../backend/db/connection.mjs';
import { createExpense, reviewExpense, listExpenses } from '../../backend/finance/expenses.mjs';

test('employee expense is owner-scoped and approval recognizes it exactly once without cash', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('expense_org','Expense Org') RETURNING id")).rows[0];
    await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1)", [org.id]);
    const article = (await pool.query("INSERT INTO qarzhy.financial_articles(code,name) VALUES('expense_test','Expense test') RETURNING id")).rows[0];
    const employee = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,organization_id,password_salt,password_hash)
      VALUES('expenseemployee','Expense Employee',(SELECT id FROM qarzhy.roles WHERE code='employee'),$1,$2,$3) RETURNING id`,
      [org.id, '0'.repeat(32), '0'.repeat(128)])).rows[0];
    const finance = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,password_salt,password_hash)
      VALUES('expensefinance','Expense Finance',(SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2) RETURNING id`,
      ['0'.repeat(32), '0'.repeat(128)])).rows[0];
    const own = { id: employee.id, name: 'Expense Employee', organization_id: org.id, permissions: ['expenses.own'] };
    const reviewer = { id: finance.id, name: 'Expense Finance', permissions: ['expenses.review', 'finance.write'] };
    const expense = await withTransaction(pool, client => createExpense({ client, principal: own, input: {
      userId: finance.id, articleId: article.id, date: '2026-11-05', amount: '25.40',
      description: 'Office supplies', vendor: 'Shop',
    } }));
    assert.equal(String(expense.user_id), String(employee.id));
    assert.equal((await listExpenses({ pool, principal: own })).length, 1);
    const otherEmployee = { id: finance.id, permissions: ['expenses.own'] };
    assert.equal((await listExpenses({ pool, principal: otherEmployee })).length, 0);
    await withTransaction(pool, client => reviewExpense({ client, principal: reviewer, id: expense.id,
      version: expense.version, decision: 'approved', note: 'Valid receipt' }));
    await assert.rejects(withTransaction(pool, client => reviewExpense({ client, principal: reviewer,
      id: expense.id, version: expense.version, decision: 'approved', note: 'Duplicate' })), /version|status|conflict/i);
    const events = await pool.query('SELECT amount::text FROM qarzhy.financial_events WHERE expense_id=$1 AND active=true', [expense.id]);
    assert.deepEqual(events.rows.map(row => row.amount), ['25.40']);
    const cash = await pool.query('SELECT count(*)::integer AS n FROM qarzhy.cash_movements WHERE expense_id=$1', [expense.id]);
    assert.equal(cash.rows[0].n, 0);
  } finally { await pool.end(); }
});
