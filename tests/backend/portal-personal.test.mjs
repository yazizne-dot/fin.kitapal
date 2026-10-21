import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { hashPassword } from '../../backend/auth/passwords.mjs';
import { startApi } from '../../backend/http/server.mjs';
import { registerAccountRoutes } from '../../backend/http/account-routes.mjs';
import { registerPortalRoutes } from '../../backend/http/portal-routes.mjs';
import { registerFinanceRoutes } from '../../backend/http/finance-routes.mjs';

test('employee portal data uses PostgreSQL identity and stays private', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  const origin = 'http://127.0.0.1:3000';
  const hashed = await hashPassword('employee personal phrase 2026');
  const employee = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,password_salt,password_hash,
    must_change_password,password_changed_at) VALUES('personalemployee','Personal Employee',
    (SELECT id FROM qarzhy.roles WHERE code='employee'),$1,$2,false,now()) RETURNING id`,
  [hashed.password_salt, hashed.password_hash])).rows[0];
  const api = await startApi({ pool, port: 0, registerRoutes: router => {
    registerAccountRoutes(router, { pool, publicOrigin: origin, csrfSecret: 'personal-portal-test-secret-32bytes' });
    registerFinanceRoutes(router, { pool, publicOrigin: origin, csrfSecret: 'personal-portal-test-secret-32bytes' });
    registerPortalRoutes(router, { pool });
  } });
  const base = `http://127.0.0.1:${api.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/data`)).status, 401);
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'personalemployee', password: 'employee personal phrase 2026' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const response = await fetch(`${base}/api/data?source=auto`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const data = await response.json();
    assert.equal(data.source, 'personal');
    assert.equal(String(data.user.id), String(employee.id));
    assert.equal(data.user.role, 'employee');
    assert.equal(data.user.password_hash, undefined);
    assert.deepEqual(data.expenses, []);
    const csrf = (await (await fetch(`${base}/api/csrf`, { headers: { cookie } })).json()).csrf_token;
    const body = { date: '2027-03-05', amount_cents: 2540, category: 'Кеңсе / Офис',
      description: 'Paper', vendor: 'Shop' };
    const noCsrf = await fetch(`${base}/api/expenses`, { method: 'POST', headers: { origin, cookie,
      'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(noCsrf.status, 403);
    const created = await fetch(`${base}/api/expenses`, { method: 'POST', headers: { origin, cookie,
      'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
    assert.equal(created.status, 201, JSON.stringify(await created.clone().json()));
    const expense = (await created.json()).expense;
    const listed = await fetch(`${base}/api/expenses`, { headers: { cookie } });
    assert.equal(listed.status, 200);
    const expenseData = await listed.json();
    assert.equal(expenseData.expenses[0].amount_cents, 2540);
    assert.equal(expenseData.expenses[0].category, 'Кеңсе / Офис');
    assert.ok(expenseData.categories.includes('Кеңсе / Офис'));
    const changed = await fetch(`${base}/api/expenses`, { method: 'PATCH', headers: { origin, cookie,
      'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ ...body,
      id: expense.id, version: expense.version, amount_cents: 3000 }) });
    assert.equal(changed.status, 200);
    const edited = (await changed.json()).expense;
    assert.equal(edited.amount, '30.00');
    const deleted = await fetch(`${base}/api/expenses`, { method: 'PATCH', headers: { origin, cookie,
      'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({
      action: 'delete', id: expense.id, version: edited.version }) });
    assert.equal(deleted.status, 200);
    assert.deepEqual((await (await fetch(`${base}/api/expenses`, { headers: { cookie } })).json()).expenses, []);
  } finally { await new Promise(resolve => api.close(resolve)); await pool.end(); }
});
