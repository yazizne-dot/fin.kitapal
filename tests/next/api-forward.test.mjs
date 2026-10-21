import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forwardApiRequest } from '../../server/http/api-forward.mjs';

test('API forwarding preserves path, method, session, CSRF, binary response and no-store', async () => {
  let target, init;
  const body = new Uint8Array([80, 75, 3, 4]);
  const request = new Request('http://127.0.0.1:3000/api/export?month=2026-08', {
    method: 'POST', headers: { cookie: 'qarzhy_session=secret', origin: 'http://127.0.0.1:3000',
      'x-csrf-token': 'csrf-value', 'content-type': 'application/json' }, body: JSON.stringify({ report: 'pnl' }),
  });
  const response = await forwardApiRequest(request, 'http://127.0.0.1:3139', async (url, options) => {
    target = String(url); init = options;
    return new Response(body, { status: 200, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="report.xlsx"', 'set-cookie': 'qarzhy_session=rotated; HttpOnly; SameSite=Strict' } });
  });
  assert.equal(target, 'http://127.0.0.1:3139/api/export?month=2026-08');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.get('cookie'), 'qarzhy_session=secret');
  assert.equal(init.headers.get('x-csrf-token'), 'csrf-value');
  assert.equal(init.headers.get('origin'), 'http://127.0.0.1:3000');
  assert.equal(response.headers.get('set-cookie'), 'qarzhy_session=rotated; HttpOnly; SameSite=Strict');
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="report.xlsx"');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), body);
});

test('API forwarding rejects non-loopback targets and reports an unavailable backend', async () => {
  const request = new Request('http://127.0.0.1:3000/api/me');
  await assert.rejects(forwardApiRequest(request, 'https://example.com/api'), /loopback/i);
  const response = await forwardApiRequest(request, 'http://127.0.0.1:3139', async () => { throw new Error('ECONNREFUSED'); });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await response.json()).error, 'API unavailable');
});
