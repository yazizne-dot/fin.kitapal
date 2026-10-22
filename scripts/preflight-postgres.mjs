import pg from 'pg';
import { inspectDatabase } from '../backend/db/preflight.mjs';

const connectionString = process.env.PREFLIGHT_DATABASE_URL;
if (!connectionString) {
  console.error('PREFLIGHT_DATABASE_URL is required; no application or migration URL is used.');
  process.exit(2);
}
const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
try {
  const report = await inspectDatabase(pool);
  console.info(JSON.stringify(report, null, 2));
  if (report.missingVersions.length || report.counts.openImportIssues)
    process.exitCode = 1;
} catch (error) {
  console.error(`Read-only preflight failed: ${error.message}`);
  process.exitCode = 1;
} finally { await pool.end(); }
