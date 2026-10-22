import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { inspectDatabase } from '../../backend/db/preflight.mjs';

test('read-only preflight reports restored data shape and does not advance finance revision', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const before = (await pool.query('SELECT revision FROM qarzhy.financial_state WHERE singleton=true')).rows[0].revision;
    const result = await inspectDatabase(pool);
    const after = (await pool.query('SELECT revision FROM qarzhy.financial_state WHERE singleton=true')).rows[0].revision;
    assert.equal(result.database, 'fin_test');
    assert.ok(result.versions.includes('0004_report_overrides'));
    assert.ok(result.versions.includes('0005_portal_operations'));
    assert.equal(result.counts.openImportIssues, 0);
    assert.ok(result.counts.datasets >= 3);
    assert.ok(Array.isArray(result.coverage));
    assert.ok(Array.isArray(result.historicalFamilies));
    assert.ok(Array.isArray(result.scopeSummary));
    assert.equal(typeof result.salesDimensions.series, 'number');
    assert.equal(typeof result.salesDimensions.mappedChannels, 'number');
    assert.ok(Array.isArray(result.cashDateRanges));
    assert.equal(after, before);
  } finally { await pool.end(); }
});
