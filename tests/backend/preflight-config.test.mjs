import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePreflightSettings } from '../../backend/db/preflight-config.mjs';

test('local preflight settings are parsed as inert text without exposing a password', () => {
  const config = parsePreflightSettings(`PGHOST=127.0.0.1\nPGPORT=5436\nPGDATABASE=fin\nPGUSER=reader\nPGPASSWORD='phrase with spaces'\n`);
  assert.deepEqual(config, { host: '127.0.0.1', port: 5436, database: 'fin',
    user: 'reader', password: 'phrase with spaces' });
  assert.equal(parsePreflightSettings('PGHOST=127.0.0.1\nPGPORT=5436\nPGDATABASE=fin\nPGUSER=reader\nPGPASSWORD=$(whoami)').password, '$(whoami)');
  assert.throws(() => parsePreflightSettings('PGHOST=127.0.0.1\nPGPORT=5436\nPGDATABASE=fin\nPGUSER=reader\nPGPASSWORD=secret\nDATABASE_URL=evil'), /unknown/i);
});
