import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { hashPassword } from '../../backend/auth/passwords.mjs';
import { startApi } from '../../backend/http/server.mjs';
import { registerAccountRoutes } from '../../backend/http/account-routes.mjs';
import { registerExportRoutes } from '../../backend/http/export-routes.mjs';

test('XLSX export requires finance session, origin and CSRF, and keeps text as text', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  const origin = 'http://127.0.0.1:3000';
  const secret = 'export-test-csrf-secret-at-least-32-bytes';
  try {
    const hash = await hashPassword('export route private phrase 2026');
    await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,password_salt,password_hash,
      must_change_password,password_changed_at) VALUES('exportfinance','Export Finance',
      (SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2,false,now())`,
    [hash.password_salt, hash.password_hash]);
    const api = await startApi({ pool, port: 0, registerRoutes: router => {
      registerAccountRoutes(router, { pool, publicOrigin: origin, csrfSecret: secret });
      registerExportRoutes(router, { pool, publicOrigin: origin, csrfSecret: secret });
    } });
    try {
      const base = `http://127.0.0.1:${api.address().port}`;
      const login = await fetch(`${base}/api/login`, { method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'exportfinance', password: 'export route private phrase 2026' }) });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const csrf = (await (await fetch(`${base}/api/csrf`, { headers: { cookie } })).json()).csrf_token;
      const body = JSON.stringify({ rows: [['Metric', 'Value'], ['=HYPERLINK("evil")', 12.5]] });
      const send = (headers, payload = body) => fetch(`${base}/api/export`, { method: 'POST',
        headers: { 'content-type': 'application/json', ...headers }, body: payload });
      assert.equal((await send({ origin, cookie })).status, 403);
      assert.equal((await send({ origin: 'https://evil.example', cookie, 'x-csrf-token': csrf })).status, 403);
      assert.equal((await send({ origin, 'x-csrf-token': csrf })).status, 401);
      assert.equal((await send({ origin, cookie, 'x-csrf-token': csrf }, JSON.stringify({ rows: [[{}]] }))).status, 400);
      const exported = await send({ origin, cookie, 'x-csrf-token': csrf });
      assert.equal(exported.status, 200);
      assert.match(exported.headers.get('cache-control'), /no-store/);
      assert.match(exported.headers.get('content-type'), /spreadsheetml\.sheet/);
      const bytes = Buffer.from(await exported.arrayBuffer());
      assert.equal(bytes.subarray(0, 2).toString(), 'PK');
      assert.ok(bytes.includes(Buffer.from('=HYPERLINK')));
      assert.ok(!bytes.includes(Buffer.from('<f>')));
    } finally { await new Promise(resolve => api.close(resolve)); }
  } finally { await pool.end(); }
});
