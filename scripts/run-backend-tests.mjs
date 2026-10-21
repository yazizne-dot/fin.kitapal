import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { assertTestDatabaseUrl, resetTestDatabase } from '../tests/backend/helpers/test-db.mjs';

if (process.env.TEST_DATABASE_URL) {
  assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  await resetTestDatabase(process.env.TEST_DATABASE_URL);
}
const tests = (await readdir(new URL('../tests/backend/', import.meta.url)))
  .filter(name => name.endsWith('.test.mjs'))
  .map(name => `tests/backend/${name}`);
const child = spawn(process.execPath, ['--test', ...tests], {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : code; });
