import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from '../../backend/http/server.mjs';
import { registerAccountRoutes } from '../../backend/http/account-routes.mjs';
import { csrfToken } from '../../backend/http/security.mjs';

const origin = 'http://127.0.0.1:3000';
const csrfSecret = 'test-only-secret-with-enough-entropy';
const rawToken = 'a'.repeat(64);
const user = { id: 1, username: 'admin', name: 'Admin', role: 'admin', language: 'ru',
  active: 1, must_change_password: 1, org: '', point: '' };

function pool() {
  return { async query(sql) {
    if (sql.includes('schema_migrations')) return { rows: [
      { version: '0001_relational_finance' }, { version: '0002_relational_source_resolution' },
      { version: '0003_node_api_security' },
      { version: '0004_report_overrides' },
      { version: '0005_portal_operations' },
    ] };
    return { rows: [] };
  } };
}

test('login cookie is protected and password-due session has only account access', async () => {
  const api = await startApi({ pool: pool(), port: 0, registerRoutes: router => registerAccountRoutes(router, {
    pool: pool(), publicOrigin: origin, csrfSecret,
    auth: {
      async login() { return { token: rawToken, expiresAt: new Date('2026-11-01T00:00:00Z'), user }; },
      async changePassword() { return { token: 'b'.repeat(64), expiresAt: new Date('2026-11-01T00:00:00Z'), user: { ...user, must_change_password: 0 } }; },
      async resolveSession() { return { ...user, password_change_due: true, token: rawToken, permissions: ['finance.read'] }; },
      async logout() {},
    },
  }) });
  const base = `http://127.0.0.1:${api.address().port}`;
  try {
    const bad = await fetch(`${base}/api/login`, { method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(bad.status, 403);
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'long password' }) });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(login.headers.get('set-cookie'), /SameSite=Strict/i);
    assert.doesNotMatch(JSON.stringify(await login.json()), new RegExp(rawToken));
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const me = await fetch(`${base}/api/me`, { headers: { cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.must_change_password, 1);
    const forbidden = await fetch(`${base}/api/profile`, { method: 'PATCH', headers: { cookie, origin, 'content-type': 'application/json', 'x-csrf-token': csrfToken(rawToken, csrfSecret) }, body: '{}' });
    assert.equal(forbidden.status, 403);
    const missingCsrf = await fetch(`${base}/api/password`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(missingCsrf.status, 403);
    const csrf = await fetch(`${base}/api/csrf`, { headers: { cookie } });
    assert.equal((await csrf.json()).csrf_token, csrfToken(rawToken, csrfSecret));
  } finally { await new Promise(resolve => api.close(resolve)); }
});
