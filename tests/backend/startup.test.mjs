import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSchema, withTransaction } from '../../backend/db/connection.mjs';
import { startApi } from '../../backend/http/server.mjs';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';

const versions = ['0001_relational_finance', '0002_relational_source_resolution', '0003_node_api_security', '0004_report_overrides', '0005_portal_operations'];

function fakePool(found = versions) {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('schema_migrations')) return { rows: found.map(version => ({ version })) };
      return { rows: [] };
    },
    release() { calls.push('RELEASE'); },
  };
  return { calls, query: client.query.bind(client), async connect() { return client; } };
}

test('schema gate accepts the restored relational schema without writing to it', async () => {
  const pool = fakePool();
  await assertSchema(pool);
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0], /^SELECT /i);
});

test('schema gate rejects a missing or incompatible migration', async () => {
  await assert.rejects(assertSchema(fakePool([])), /schema|migration/i);
  await assert.rejects(assertSchema(fakePool(['0001_relational_finance'])), /schema|migration/i);
  await assert.rejects(assertSchema(fakePool([...versions, 'unexpected_version'])), /schema|migration/i);
});

test('transaction rolls back and releases the checked-out client on failure', async () => {
  const pool = fakePool();
  await assert.rejects(withTransaction(pool, async client => {
    await client.query('SELECT 1');
    throw new Error('injected failure');
  }), /injected failure/);
  assert.deepEqual(pool.calls, ['BEGIN', 'SELECT 1', 'ROLLBACK', 'RELEASE']);
});

test('health returns success only after a database check', async () => {
  const pool = fakePool();
  const api = await startApi({ pool, host: '127.0.0.1', port: 0 });
  try {
    const response = await fetch(`http://127.0.0.1:${api.address().port}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  } finally {
    await new Promise(resolve => api.close(resolve));
  }
  await assert.rejects(startApi({ pool: fakePool([]), host: '127.0.0.1', port: 0 }), /schema|migration/i);
});

test('test helper refuses a restored or production database', () => {
  assert.throws(() => assertTestDatabaseUrl('postgres://user:pass@127.0.0.1:15434/fin'), /fin_test/);
  assert.equal(assertTestDatabaseUrl('postgres://user:pass@127.0.0.1:15435/fin_test'), 'postgres://user:pass@127.0.0.1:15435/fin_test');
});
