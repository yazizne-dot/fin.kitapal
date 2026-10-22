import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { hashPassword } from '../../backend/auth/passwords.mjs';
import { startApi } from '../../backend/http/server.mjs';
import { registerAccountRoutes } from '../../backend/http/account-routes.mjs';
import { registerFinanceRoutes } from '../../backend/http/finance-routes.mjs';

test('finance HTTP routes require a live session and CSRF then post one document', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  const origin = 'http://127.0.0.1:3000';
  const csrfSecret = 'finance-test-secret-with-enough-entropy';
  const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('finance_http_org','Finance HTTP Org') RETURNING id")).rows[0];
  await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1)", [org.id]);
  const customer = (await pool.query("INSERT INTO qarzhy.counterparties(name) VALUES('Finance HTTP Customer') RETURNING id")).rows[0];
  const hashed = await hashPassword('finance http private phrase 2026');
  await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,organization_id,password_salt,password_hash,must_change_password,password_changed_at)
    VALUES('financehttp','Finance HTTP',(SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2,$3,false,now())`,
    [org.id, hashed.password_salt, hashed.password_hash]);
  const api = await startApi({ pool, port: 0, registerRoutes: router => {
    registerAccountRoutes(router, { pool, publicOrigin: origin, csrfSecret });
    registerFinanceRoutes(router, { pool, publicOrigin: origin, csrfSecret });
  } });
  const base = `http://127.0.0.1:${api.address().port}`;
  try {
    const anonymous = await fetch(`${base}/api/documents`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(anonymous.status, 401);
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'financehttp', password: 'finance http private phrase 2026' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const csrf = (await (await fetch(`${base}/api/csrf`, { headers: { cookie } })).json()).csrf_token;
    const input = { organizationId: org.id, counterpartyId: customer.id, kind: 'sale', mode: 'summary',
      number: 'HTTP-SALE-1', date: '2026-11-04', amount: '42.30', idempotencyKey: 'http-sale-1' };
    const noCsrf = await fetch(`${base}/api/documents`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(noCsrf.status, 403);
    const created = await fetch(`${base}/api/documents`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(input) });
    assert.equal(created.status, 201);
    const draft = (await created.json()).document;
    const posted = await fetch(`${base}/api/documents/post`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ id: draft.id, version: draft.version, idempotencyKey: input.idempotencyKey }) });
    assert.equal(posted.status, 200);
    assert.equal((await posted.json()).document.status, 'posted');
    const reversal = await fetch(`${base}/api/documents/reverse`, { method: 'POST', headers: { origin, cookie,
      'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ id: draft.id, reason: 'Duplicate invoice' }) });
    assert.equal(reversal.status, 200);
    assert.equal((await reversal.json()).document.status, 'reversed');
    const portalSale = await fetch(`${base}/api/operations`, { method: 'POST', headers: {
      origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf,
    }, body: JSON.stringify({ source: 'manual', external_id: 'http-sale-portal',
      date: '2026-11-05', org: 'Finance HTTP Org', point: '', counterparty: 'Finance HTTP Customer',
      document: 'HTTP-PORTAL-1', kind: 'sale', amount: 100, cost: 20, due: '', article: '' }) });
    assert.equal(portalSale.status, 201);
    const portalId = Number((await portalSale.json()).operation.id);
    const deniedCorrection = await fetch(`${base}/api/correction`, { method: 'POST', headers: {
      origin, cookie, 'content-type': 'application/json',
    }, body: JSON.stringify({ id: -portalId, amount: 120, cost: 20, reason: 'Price fix' }) });
    assert.equal(deniedCorrection.status, 403);
    const correction = await fetch(`${base}/api/correction`, { method: 'POST', headers: {
      origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf,
    }, body: JSON.stringify({ id: -portalId, amount: 120, cost: 20, reason: 'Price fix' }) });
    assert.equal(correction.status, 200);
    assert.equal((await correction.json()).operation.amount, '120.00');
    const legacyPlan = { date: '2026-11-12', org: 'Finance HTTP Org',
      article: 'New finance HTTP article', direction: 'out', amount: 75 };
    const deniedPlan = await fetch(`${base}/api/plans`, { method: 'POST', headers: {
      origin, cookie, 'content-type': 'application/json',
    }, body: JSON.stringify(legacyPlan) });
    assert.equal(deniedPlan.status, 403);
    const savedPlan = await fetch(`${base}/api/plans`, { method: 'POST', headers: {
      origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf,
    }, body: JSON.stringify(legacyPlan) });
    assert.equal(savedPlan.status, 201);
    assert.equal((await savedPlan.json()).plan.amount, '75.00');
    const closed = await fetch(`${base}/api/period`, { method: 'POST', headers: {
      origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf,
    }, body: JSON.stringify({ month: '2026-11', closed: true, reason: '' }) });
    assert.equal(closed.status, 200);
    const closedPeriods = (await closed.json()).periods;
    assert.deepEqual(closedPeriods.map(row => row.organization_id), [org.id]);
    const noReopenReason = await fetch(`${base}/api/period`, { method: 'POST', headers: {
      origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf,
    }, body: JSON.stringify({ month: '2026-11', closed: false, reason: '' }) });
    assert.equal(noReopenReason.status, 422);
  } finally { await new Promise(resolve => api.close(resolve)); await pool.end(); }
});
