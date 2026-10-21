import { readFile } from 'node:fs/promises';
import pg from 'pg';

export function assertTestDatabaseUrl(connectionString) {
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required');
  const url = new URL(connectionString);
  if (url.pathname !== '/fin_test') throw new Error('Refusing to modify a database other than fin_test');
  return connectionString;
}

export async function resetTestDatabase(connectionString) {
  const safeUrl = assertTestDatabaseUrl(connectionString);
  const client = new pg.Client({ connectionString: safeUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS qarzhy CASCADE');
    const schema = await readFile(new URL('../../../docs/sql/postgres-relational-schema.sql', import.meta.url), 'utf8');
    await client.query(schema);
    await client.query("INSERT INTO qarzhy.schema_migrations(version) VALUES ('0002_relational_source_resolution')");
    const migration = await readFile(new URL('../../../docs/sql/migrations/0003_node_api_security.sql', import.meta.url), 'utf8');
    await client.query(migration);
    const overrides = await readFile(new URL('../../../docs/sql/migrations/0004_report_overrides.sql', import.meta.url), 'utf8');
    await client.query(overrides);
  } finally {
    await client.end();
  }
}
