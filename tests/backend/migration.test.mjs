import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('migration runner refuses DATABASE_URL alone', () => {
  const result = spawnSync(process.execPath, ['scripts/migrate-postgres.mjs'], {
    env: { ...process.env, DATABASE_URL: 'postgres://user:pass@127.0.0.1:15434/fin', MIGRATION_DATABASE_URL: '' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MIGRATION_DATABASE_URL/);
});
