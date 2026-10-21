import { readFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) {
  console.error('MIGRATION_DATABASE_URL is required; DATABASE_URL is never used for migrations.');
  process.exit(2);
}
const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) {
  console.error('Usage: node scripts/migrate-postgres.mjs --check|--apply');
  process.exit(2);
}
const client = new pg.Client({ connectionString });
try {
  await client.connect();
  const target = (await client.query('SELECT current_database() AS database, current_user AS role')).rows[0];
  const versions = (await client.query('SELECT version FROM qarzhy.schema_migrations ORDER BY version')).rows.map(row => row.version);
  console.info(`Database: ${target.database}; role: ${target.role}; versions: ${versions.join(', ')}`);
  if (mode === '--apply') {
    for (const name of ['0003_node_api_security', '0004_report_overrides']) {
      const sql = await readFile(new URL(`../docs/sql/migrations/${name}.sql`, import.meta.url), 'utf8');
      await client.query(sql);
      console.info(`Applied or verified ${name}`);
    }
  }
} catch (error) {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
