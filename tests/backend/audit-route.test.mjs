import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { hashPassword } from '../../backend/auth/passwords.mjs';
import { startApi } from '../../backend/http/server.mjs';
import { registerAccountRoutes } from '../../backend/http/account-routes.mjs';
import { registerAuditRoutes } from '../../backend/http/audit-routes.mjs';

test('audit view requires management permission and does not expose raw audit JSON', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  const origin = 'http://127.0.0.1:3000';
  const hashed = await hashPassword('audit admin private phrase 2026');
  for (const role of ['admin', 'finance']) await pool.query(`INSERT INTO qarzhy.users
    (username,name,role_id,password_salt,password_hash,must_change_password,password_changed_at)
    VALUES($1,$2,(SELECT id FROM qarzhy.roles WHERE code=$3),$4,$5,false,now())`,
  [`audit${role}`, `Audit ${role}`, 'finance', hashed.password_salt, hashed.password_hash]);
  await pool.query(`INSERT INTO qarzhy.user_permissions(user_id,permission_id,allowed)
    SELECT u.id,p.id,true FROM qarzhy.users u CROSS JOIN qarzhy.permissions p
    WHERE u.username='auditadmin' AND p.code='accounts.manage'`);
  await pool.query(`INSERT INTO qarzhy.audit_log(actor_name,action,entity_type,entity_id,before_data,reason)
    VALUES('System','sensitive_test','user',1,'{"secret":"do-not-return"}','Reviewed')`);
  const api = await startApi({ pool, port: 0, registerRoutes: router => {
    registerAccountRoutes(router, { pool, publicOrigin: origin, csrfSecret: 'audit-route-test-secret-32bytes-value' });
    registerAuditRoutes(router, { pool });
  } });
  const base = `http://127.0.0.1:${api.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/finance/audit`)).status, 401);
    async function cookie(role) {
      const response = await fetch(`${base}/api/login`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ username: `audit${role}`, password: 'audit admin private phrase 2026' }) });
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie').split(';')[0];
    }
    assert.equal((await fetch(`${base}/api/finance/audit`, { headers: { cookie: await cookie('finance') } })).status, 403);
    const response = await fetch(`${base}/api/finance/audit`, { headers: { cookie: await cookie('admin') } });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.doesNotMatch(body, /do-not-return/);
    const row = JSON.parse(body).audit.find(entry => entry.action === 'sensitive_test');
    assert.equal(row.author, 'System');
    assert.match(row.detail, /Reviewed/);
  } finally { await new Promise(resolve => api.close(resolve)); await pool.end(); }
});
