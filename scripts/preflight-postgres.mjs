import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { inspectDatabase } from '../backend/db/preflight.mjs';
import { parsePreflightSettings } from '../backend/db/preflight-config.mjs';

let connection;
if (process.env.PREFLIGHT_DATABASE_URL) connection = { connectionString: process.env.PREFLIGHT_DATABASE_URL };
else {
  try {
    const text = await readFile(new URL('../.env.pg-preflight.local', import.meta.url), 'utf8');
    connection = parsePreflightSettings(text);
  } catch (error) {
    console.error(error.code === 'ENOENT'
      ? 'Set PREFLIGHT_DATABASE_URL or create .env.pg-preflight.local; application and migration URLs are never used.'
      : `Invalid local preflight settings: ${error.message}`);
    process.exit(2);
  }
}
const pool = new pg.Pool({ ...connection, max: 1, connectionTimeoutMillis: 5000 });
try {
  const report = await inspectDatabase(pool);
  console.info(JSON.stringify(report, null, 2));
  if (report.missingVersions.length || report.counts.openImportIssues)
    process.exitCode = 1;
} catch (error) {
  console.error(`Read-only preflight failed: ${error.message}`);
  process.exitCode = 1;
} finally { await pool.end(); }
