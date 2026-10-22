import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { withTransaction } from '../../backend/db/connection.mjs';
import { importPortalOperations } from '../../backend/finance/portal-import.mjs';

test('CSV import keeps valid rows, counts duplicates, and rolls back invalid rows individually',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
    try {
      const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('portal_import_org','Portal Import Org') RETURNING id")).rows[0];
      const user = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,organization_id,password_salt,password_hash)
        VALUES('portalimportfinance','Portal Import Finance',(SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2,$3)
        RETURNING id`, [org.id, '0'.repeat(32), '0'.repeat(128)])).rows[0];
      const principal = { id: user.id, name: 'Portal Import Finance', role: 'finance',
        organization_id: org.id, permissions: ['finance.write'] };
      const row = { source: 'csv-test', external_id: 'csv-1', date: '2036-06-07',
        org: 'Portal Import Org', point: '', counterparty: 'CSV Buyer', document: 'CSV-1',
        kind: 'sale', amount: 900, cost: 300, due: '', article: 'Books' };
      const result = await withTransaction(pool, client => importPortalOperations({ client, principal,
        rows: [row, { ...row }, { ...row, external_id: 'bad', amount: -1 },
          { ...row, external_id: 'cash', kind: 'receipt', cost: 0 }] }));
      assert.deepEqual([result.added, result.duplicates], [1, 1]);
      assert.deepEqual(result.errors.map(error => error.row), [4, 5]);
      assert.match(result.errors[1].message, /cash account/i);
      assert.equal((await pool.query(`SELECT count(*)::int n FROM qarzhy.portal_operations
        WHERE organization_id=$1`, [org.id])).rows[0].n, 1);
      assert.equal((await pool.query(`SELECT count(*)::int n FROM qarzhy.financial_events
        WHERE organization_id=$1`, [org.id])).rows[0].n, 1);
      const repeated = await withTransaction(pool, client => importPortalOperations({ client, principal, rows: [row] }));
      assert.deepEqual([repeated.added, repeated.duplicates, repeated.errors.length], [0, 1, 0]);
      await assert.rejects(withTransaction(pool, client => importPortalOperations({ client, principal,
        rows: Array.from({ length: 5001 }, () => row) })), /5000/);
    } finally { await pool.end(); }
  });
