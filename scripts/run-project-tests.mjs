import { spawnSync } from 'node:child_process';

for (const script of ['run-backend-tests.mjs', 'run-next-tests.mjs']) {
  const result = spawnSync(process.execPath, [`scripts/${script}`], {
    stdio: 'inherit', env: process.env,
  });
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    break;
  }
}
if (!process.exitCode) {
  const result = spawnSync(process.execPath,
    ['scripts/run-test-files.mjs', '--tsx', 'tests/react', 'features/workbook'], {
      stdio: 'inherit', env: process.env,
    });
  process.exitCode = result.status || 0;
}
