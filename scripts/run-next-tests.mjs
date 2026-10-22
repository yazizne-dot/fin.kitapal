import { spawnSync } from 'node:child_process';

for (const args of [
  ['node_modules/next/dist/bin/next', 'build'],
  ['scripts/run-test-files.mjs', '--tsx', 'tests/next'],
]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    break;
  }
}
