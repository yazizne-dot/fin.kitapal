import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { GET } from '../../app/api/[...path]/route.ts';

test('Next API route requires the Node API and forwards to it without a SQLite fallback', async () => {
  const previous = process.env.API_INTERNAL_URL;
  delete process.env.API_INTERNAL_URL;
  const request = new Request('http://127.0.0.1:3000/api/me');
  const backend = createServer((_request, response) => {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Authentication required' }));
  });
  try {
    const unavailable = await GET(request);
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).error, 'API unavailable');
    backend.listen(0, '127.0.0.1');
    await once(backend, 'listening');
    process.env.API_INTERNAL_URL = `http://127.0.0.1:${backend.address().port}`;
    const forwarded = await GET(request);
    assert.equal(forwarded.status, 401);
    assert.equal((await forwarded.json()).error, 'Authentication required');
  } finally {
    if (previous === undefined) delete process.env.API_INTERNAL_URL;
    else process.env.API_INTERNAL_URL = previous;
    if (backend.listening) await new Promise(resolve => backend.close(resolve));
  }
});
