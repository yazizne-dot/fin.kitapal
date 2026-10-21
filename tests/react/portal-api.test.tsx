import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortalIdentityFirst, createPortalRequester } from '../../features/portal/api-client';

const user = { id: 1, name: 'Admin', username: 'admin', role: 'admin', language: 'ru',
  active: 1, must_change_password: 1, org: '', point: '' } as const;

test('expired-password user reaches account data without requesting financial data', async () => {
  const calls: string[] = [];
  const api = async <T,>(path: string): Promise<T> => {
    calls.push(path);
    if (path === '/api/me') return { user } as T;
    throw new Error('Financial data must not be requested');
  };
  const result = await loadPortalIdentityFirst(api, 'source=auto');
  assert.equal(result.source, 'personal');
  assert.equal(result.user.must_change_password, 1);
  assert.deepEqual(calls, ['/api/me']);
});

test('mutations fetch a session CSRF token and return financial data after identity', async () => {
  const calls: string[] = [];
  const fetcher = async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = String(input); calls.push(path);
    if (path === '/api/csrf') return Response.json({ csrf_token: 'bound-token' });
    if (path === '/api/password') {
      assert.equal(new Headers(options?.headers).get('x-csrf-token'), 'bound-token');
      return Response.json({ ok: true });
    }
    if (path === '/api/me') return Response.json({ user: { ...user, must_change_password: 0 } });
    if (path.startsWith('/api/data')) return Response.json({ source: 'personal', user: { ...user, must_change_password: 0 } });
    throw new Error(path);
  };
  const api = createPortalRequester(fetcher);
  await api('/api/password', { method: 'POST', body: JSON.stringify({ current_password: 'old', new_password: 'new' }) });
  await loadPortalIdentityFirst(api, 'source=auto');
  assert.deepEqual(calls, ['/api/csrf', '/api/password', '/api/me', '/api/data?source=auto']);
});
