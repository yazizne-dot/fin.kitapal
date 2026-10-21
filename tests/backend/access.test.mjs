import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csrfToken, checkMutationRequest } from '../../backend/http/security.mjs';
import { requirePermission } from '../../backend/auth/guards.mjs';
import { registerAccountRoutes } from '../../backend/http/account-routes.mjs';

const origin = 'http://127.0.0.1:3000';
const csrfSecret = 'test-only-secret-with-enough-entropy';
const principal = { id: 17, role: 'employee', token: 'a'.repeat(64), permissions: ['expenses.own'] };

test('CSRF token is bound to the session and must accompany same-origin mutations', () => {
  const token = csrfToken(principal.token, csrfSecret);
  assert.notEqual(token, csrfToken('b'.repeat(64), csrfSecret));
  const base = { origin, 'sec-fetch-site': 'same-origin', 'x-csrf-token': token };
  assert.doesNotThrow(() => checkMutationRequest({ method: 'POST', headers: base }, principal, { origin, csrfSecret }));
  assert.throws(() => checkMutationRequest({ method: 'POST', headers: { ...base, 'x-csrf-token': undefined } }, principal, { origin, csrfSecret }), /CSRF/i);
  assert.throws(() => checkMutationRequest({ method: 'POST', headers: { ...base, origin: 'https://attacker.example' } }, principal, { origin, csrfSecret }), /Origin/i);
  assert.throws(() => checkMutationRequest({ method: 'POST', headers: { ...base, 'sec-fetch-site': 'cross-site' } }, principal, { origin, csrfSecret }), /site/i);
});

test('login mutation validates origin even before a session exists', () => {
  assert.doesNotThrow(() => checkMutationRequest({ method: 'POST', headers: { origin, 'sec-fetch-site': 'same-origin' } }, null, { origin, csrfSecret }));
  assert.throws(() => checkMutationRequest({ method: 'POST', headers: { origin: 'https://attacker.example' } }, null, { origin, csrfSecret }), /Origin/i);
});

test('employee permission is scoped to own records', () => {
  assert.doesNotThrow(() => requirePermission(principal, 'expenses.own', 17));
  assert.throws(() => requirePermission(principal, 'expenses.own', 18), /forbidden/i);
  assert.throws(() => requirePermission(principal, 'accounts.manage'), /forbidden/i);
});

test('account routes require a strong CSRF secret and canonical public origin', () => {
  const router = { add() {} };
  assert.throws(() => registerAccountRoutes(router, { pool: {}, publicOrigin: origin, csrfSecret: 'short' }), /CSRF_SECRET/);
  assert.throws(() => registerAccountRoutes(router, { pool: {}, publicOrigin: 'http://127.0.0.1:3000/path', csrfSecret }), /PUBLIC_APP_ORIGIN/);
});
