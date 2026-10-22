import pg from 'pg';

// A PostgreSQL DATE has no timezone. Keep it as YYYY-MM-DD so the host timezone
// cannot move a reporting boundary to the previous UTC day.
pg.types.setTypeParser(pg.types.builtins.DATE, value => value);

const REQUIRED_VERSIONS = ['0001_relational_finance', '0002_relational_source_resolution', '0003_node_api_security', '0004_report_overrides', '0005_portal_operations'];

export function createPool({ connectionString } = {}) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
}

export async function assertSchema(pool, requiredVersions = REQUIRED_VERSIONS) {
  let result;
  try {
    result = await pool.query('SELECT version FROM qarzhy.schema_migrations ORDER BY version');
  } catch (error) {
    throw new Error('PostgreSQL schema is unavailable or missing', { cause: error });
  }
  const actual = result.rows.map(row => row.version);
  if (actual.length !== requiredVersions.length || actual.some((version, index) => version !== requiredVersions[index])) {
    throw new Error(`PostgreSQL schema migration mismatch: expected ${requiredVersions.join(', ')}`);
  }
}

export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  } finally {
    client.release();
  }
}
