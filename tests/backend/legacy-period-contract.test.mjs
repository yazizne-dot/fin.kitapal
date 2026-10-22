import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { withTransaction } from '../../backend/db/connection.mjs';
import * as planning from '../../backend/finance/planning.mjs';

test('legacy global month closure covers all organizations atomically; scoped closure stays scoped',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
    const admin = { id: '1', name: 'Admin', permissions: ['finance.write'] };
    try {
      const first = (await pool.query(`INSERT INTO qarzhy.organizations(code,name)
        VALUES('legacy_period_first','Legacy Period First') RETURNING id`)).rows[0];
      const second = (await pool.query(`INSERT INTO qarzhy.organizations(code,name)
        VALUES('legacy_period_second','Legacy Period Second') RETURNING id`)).rows[0];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const global = await planning.setLegacyPeriodClosed({ client, principal: admin,
          input: { month: '2034-06', closed: true, reason: '' } });
        assert.ok(global.periods.some(row => row.organization_id === first.id));
        assert.ok(global.periods.some(row => row.organization_id === second.id));
        assert.equal((await client.query(`SELECT count(*)::int AS n FROM qarzhy.accounting_periods
          WHERE starts_on='2034-06-01' AND closed=true`)).rows[0].n, global.periods.length);
        await assert.rejects(planning.setLegacyPeriodClosed({ client, principal: admin,
          input: { month: '2034-06', closed: false, reason: '' } }), /reason/i);
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM qarzhy.accounting_periods
        WHERE starts_on='2034-06-01'`)).rows[0].n, 0);
      const scoped = { ...admin, organization_id: first.id };
      const own = await withTransaction(pool, client => planning.setLegacyPeriodClosed({ client,
        principal: scoped, input: { month: '2034-06', closed: true, reason: '' } }));
      assert.deepEqual(own.periods.map(row => row.organization_id), [first.id]);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM qarzhy.accounting_periods
        WHERE starts_on='2034-06-01' AND closed=true`)).rows[0].n, 1);
      await assert.rejects(withTransaction(pool, client => planning.setLegacyPeriodClosed({ client,
        principal: scoped, input: { month: '2034-06', closed: false, reason: '' } })), /reason/i);
      const reopened = await withTransaction(pool, client => planning.setLegacyPeriodClosed({ client,
        principal: scoped, input: { month: '2034-06', closed: false, reason: 'Reviewed correction' } }));
      assert.equal(reopened.periods[0].closed, false);
    } finally { await pool.end(); }
  });
