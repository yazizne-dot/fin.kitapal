import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { hashPassword, verifyPassword, validateNewPassword, passwordChangeDue } from '../../backend/auth/passwords.mjs';
import { hashToken, issueSession, resolveSession } from '../../backend/auth/sessions.mjs';
import { login, changePassword } from '../../backend/auth/accounts.mjs';

test('imported scrypt hashes remain valid and new hashes use the same format', async () => {
  const salt = '0123456789abcdef0123456789abcdef';
  const imported = { password_salt: salt, password_hash: scryptSync('an imported passphrase', salt, 64).toString('hex') };
  assert.equal(await verifyPassword('an imported passphrase', imported), true);
  assert.equal(await verifyPassword('incorrect', imported), false);
  const fresh = await hashPassword('a sufficiently long passphrase');
  assert.match(fresh.password_salt, /^[0-9a-f]{32}$/);
  assert.match(fresh.password_hash, /^[0-9a-f]{128}$/);
  assert.equal(await verifyPassword('a sufficiently long passphrase', fresh), true);
});

test('password policy accepts long passphrases and rejects weak values', () => {
  assert.throws(() => validateNewPassword('short'), /15/);
  assert.throws(() => validateNewPassword('passwordpassword'), /common|weak/i);
  assert.doesNotThrow(() => validateNewPassword('my long private phrase 2026'));
});

test('all roles have a 30-day deadline; unknown imported change date is due', () => {
  const now = new Date('2026-10-21T00:00:00Z');
  assert.equal(passwordChangeDue({ role: 'admin', password_changed_at: null }, now), true);
  assert.equal(passwordChangeDue({ role: 'employee', password_changed_at: '2026-09-21T00:00:00Z' }, now), true);
  assert.equal(passwordChangeDue({ role: 'finance', password_changed_at: '2026-09-22T00:00:00Z' }, now), false);
  assert.equal(passwordChangeDue({ must_change_password: true, password_changed_at: '2026-10-20T00:00:00Z' }, now), true);
});

test('session storage receives only token hash and bounded expiry', async () => {
  const recorded = [];
  const client = { async query(sql, params) { recorded.push({ sql, params }); return { rows: [] }; } };
  const now = new Date('2026-10-21T00:00:00Z');
  const normal = await issueSession(client, { userId: 7, remember: false, now });
  assert.equal(normal.expiresAt.toISOString(), '2026-10-22T00:00:00.000Z');
  const remembered = await issueSession(client, { userId: 7, remember: true, now });
  assert.equal(remembered.expiresAt.toISOString(), '2026-11-20T00:00:00.000Z');
  assert.equal(recorded.length, 2);
  for (const { params } of recorded) {
    assert.equal(params.some(value => value === normal.token || value === remembered.token), false);
    assert.equal(params[1].equals(hashToken(params === recorded[0].params ? normal.token : remembered.token)), true);
  }
});

test('disabled user and expired session cannot resolve', async () => {
  const now = new Date('2026-10-21T00:00:00Z');
  const pool = { async query() { return { rows: [{ id: 1, active: false, expires_at: '2026-10-22T00:00:00Z' }] }; } };
  assert.equal(await resolveSession({ pool, token: 'a'.repeat(64), now }), null);
  pool.query = async () => ({ rows: [{ id: 1, active: true, expires_at: '2026-10-20T00:00:00Z' }] });
  assert.equal(await resolveSession({ pool, token: 'a'.repeat(64), now }), null);
});

test('resolved session gets explicit database permissions', async () => {
  const queries = [];
  const pool = { async query(sql) {
    queries.push(sql);
    if (sql.includes('FROM qarzhy.sessions')) return { rows: [{ id: 7, role_id: 2, role: 'finance', active: true,
      expires_at: '2026-10-22T00:00:00Z', password_changed_at: '2026-10-20T00:00:00Z' }] };
    return { rows: [{ code: 'finance.read' }, { code: 'expenses.review' }] };
  } };
  const principal = await resolveSession({ pool, token: 'a'.repeat(64), now: new Date('2026-10-21T00:00:00Z') });
  assert.deepEqual(principal.permissions, ['finance.read', 'expenses.review']);
  assert.ok(queries.some(sql => sql.includes('qarzhy.user_permissions')));
});

test('unknown username and wrong password return the same login error', async () => {
  const user = { id: 7, username: 'admin', name: 'Admin', active: true,
    ...(await hashPassword('my long private phrase 2026')), role: 'admin', password_changed_at: null };
  function poolFor(found) {
    const client = {
      async query(sql) {
        if (sql.includes('FROM qarzhy.login_attempts')) return { rows: [{ failed_count: 0, blocked_until: null }] };
        if (sql.includes('FROM qarzhy.users')) return { rows: found ? [user] : [] };
        return { rows: [] };
      },
      release() {},
    };
    return { async connect() { return client; } };
  }
  const wrong = await login({ pool: poolFor(true), username: 'admin', password: 'incorrect', now: new Date() }).catch(error => error.message);
  const unknown = await login({ pool: poolFor(false), username: 'unknown', password: 'incorrect', now: new Date() }).catch(error => error.message);
  assert.equal(wrong, unknown);
});

test('password change revokes old sessions and returns a rotated token', async () => {
  const old = await hashPassword('my old private phrase 2026');
  const user = { id: 7, username: 'admin', name: 'Admin', active: true, ...old };
  const sqls = [];
  const client = {
    async query(sql) {
      sqls.push(sql);
      if (sql.includes('FROM qarzhy.users')) return { rows: [user] };
      return { rows: [] };
    },
    release() {},
  };
  const result = await changePassword({ pool: { async connect() { return client; } },
    principal: { id: 7, token: 'a'.repeat(64) }, currentPassword: 'my old private phrase 2026',
    newPassword: 'my new private phrase 2026', now: new Date('2026-10-21T00:00:00Z') });
  assert.match(result.token, /^[0-9a-f]{64}$/);
  assert.notEqual(result.token, 'a'.repeat(64));
  assert.ok(sqls.some(sql => sql.includes('DELETE FROM qarzhy.sessions WHERE user_id')));
  assert.ok(sqls.some(sql => sql.includes('INSERT INTO qarzhy.audit_log')));
});
