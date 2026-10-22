import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv.slice(2);
const tsx = args[0] === '--tsx';
const folders = tsx ? args.slice(1) : args;
if (!folders.length) throw new Error('At least one test directory is required');

async function testFiles(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? testFiles(join(folder, entry.name))
    : /\.test\.(?:mjs|tsx)$/.test(entry.name) ? [join(folder, entry.name)] : []));
  return nested.flat();
}
const files = (await Promise.all(folders.map(testFiles))).flat().sort();
if (!files.length) throw new Error('No test files found');
const child = spawn(process.execPath, [...(tsx ? ['--import', 'tsx'] : []), '--test', ...files], {
  stdio: 'inherit', env: process.env,
});
child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : code; });
