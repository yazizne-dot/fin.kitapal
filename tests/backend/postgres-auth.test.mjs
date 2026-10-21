import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { hashPassword } from '../../backend/auth/passwords.mjs';
import { login, changePassword } from '../../backend/auth/accounts.mjs';
import { resolveSession } from '../../backend/auth/sessions.mjs';
import { updateUser, updateProfile } from '../../backend/auth/user-management.mjs';
import { startApi } from '../../backend/http/server.mjs';
import { registerAccountRoutes } from '../../backend/http/account-routes.mjs';

test('real PostgreSQL login, password deadline, token hash, rotation and shared lockout', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const connectionString = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const pool = new pg.Pool({ connectionString });
  try {
    const hash = await hashPassword('first private phrase 2026');
    const inserted = await pool.query(`INSERT INTO qarzhy.users
      (username,name,role_id,password_salt,password_hash,must_change_password)
      VALUES('testadmin','Test Admin',(SELECT id FROM qarzhy.roles WHERE code='admin'),$1,$2,true)
      RETURNING id`, [hash.password_salt, hash.password_hash]);
    const id = inserted.rows[0].id;
    const now = new Date('2026-10-21T00:00:00Z');
    const first = await login({ pool, username: 'testadmin', password: 'first private phrase 2026', now });
    const stored = await pool.query('SELECT token_hash FROM qarzhy.sessions WHERE user_id=$1', [id]);
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].token_hash.toString('hex').length, 64);
    assert.notEqual(stored.rows[0].token_hash.toString('hex'), first.token);
    const principal = await resolveSession({ pool, token: first.token, now });
    assert.equal(principal.password_change_due, true);
    assert.ok(principal.permissions.includes('accounts.manage'));
    const changed = await changePassword({ pool, principal: { ...principal, token: first.token },
      currentPassword: 'first private phrase 2026', newPassword: 'second private phrase 2026', now });
    assert.equal(await resolveSession({ pool, token: first.token, now }), null);
    const current = await resolveSession({ pool, token: changed.token, now });
    assert.equal(current.password_change_due, false);
    for (let i = 0; i < 5; i++) await assert.rejects(login({ pool, username: 'testadmin', password: 'wrong passphrase', now }), /Invalid username or password/);
    await assert.rejects(login({ pool, username: 'testadmin', password: 'second private phrase 2026', now }), /Invalid username or password/);
    const attempts = await pool.query('SELECT failed_count FROM qarzhy.login_attempts');
    assert.equal(attempts.rows[0].failed_count, 5);
  } finally { await pool.end(); }
});

test('standalone HTTP process logs in, reads identity and logs out using PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  const origin = 'http://127.0.0.1:3000';
  const hashed = await hashPassword('smoke private phrase 2026');
  await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,password_salt,password_hash)
    VALUES('smokeemployee','Smoke Employee',(SELECT id FROM qarzhy.roles WHERE code='employee'),$1,$2)`,
  [hashed.password_salt, hashed.password_hash]);
  const api = await startApi({ pool, port: 0, registerRoutes: router => registerAccountRoutes(router, {
    pool, publicOrigin: origin, csrfSecret: 'local-test-secret-with-enough-entropy',
  }) });
  const base = `http://127.0.0.1:${api.address().port}`;
  try {
    const response = await fetch(`${base}/api/login`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'smokeemployee', password: 'smoke private phrase 2026' }) });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const identity = await fetch(`${base}/api/me`, { headers: { cookie } });
    assert.equal(identity.status, 200);
    assert.equal((await identity.json()).user.must_change_password, 1);
    const token = (await (await fetch(`${base}/api/csrf`, { headers: { cookie } })).json()).csrf_token;
    const loggedOut = await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie, origin, 'x-csrf-token': token } });
    assert.equal(loggedOut.status, 200);
    assert.equal((await fetch(`${base}/api/me`, { headers: { cookie } })).status, 401);
  } finally {
    await new Promise(resolve => api.close(resolve));
    await pool.end();
  }
});

test('password-change guesses are limited in PostgreSQL even with the correct session', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const hashed = await hashPassword('rate old private phrase 2026');
    await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,password_salt,password_hash)
      VALUES('rateemployee','Rate Employee',(SELECT id FROM qarzhy.roles WHERE code='employee'),$1,$2)`,
      [hashed.password_salt, hashed.password_hash]);
    const now = new Date('2026-10-21T00:00:00Z');
    const session = await login({ pool, username: 'rateemployee', password: 'rate old private phrase 2026', now });
    const principal = { id: session.user.id, token: session.token };
    for (let i = 0; i < 5; i++) await assert.rejects(changePassword({ pool, principal,
      currentPassword: 'wrong', newPassword: 'rate new private phrase 2026', now }), /password|attempt/i);
    await assert.rejects(changePassword({ pool, principal,
      currentPassword: 'rate old private phrase 2026', newPassword: 'rate new private phrase 2026', now }), /attempt|rate|locked/i);
  } finally { await pool.end(); }
});

test('last active admin cannot be disabled; profile language persists', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const user = (await pool.query("SELECT id,name FROM qarzhy.users WHERE username='testadmin'")).rows[0];
    await assert.rejects(updateUser({ pool, actor: { id: user.id, name: user.name, role: 'admin' },
      userId: user.id, changes: { active: false } }), /last active admin/i);
    const result = await updateProfile({ pool, principal: { id: user.id, name: user.name, role: 'admin' },
      changes: { language: 'ru' } });
    assert.equal(result.language, 'ru');
    const persisted = await pool.query('SELECT language,active FROM qarzhy.users WHERE id=$1', [user.id]);
    assert.equal(persisted.rows[0].language, 'ru');
    assert.equal(persisted.rows[0].active, true);
  } finally { await pool.end(); }
});
