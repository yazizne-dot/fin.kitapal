import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { withTransaction } from '../../backend/db/connection.mjs';
import * as planning from '../../backend/finance/planning.mjs';

test('legacy plan form resolves scoped names, creates one article and keeps finance facts intact',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
    try {
      const org = (await pool.query(`INSERT INTO qarzhy.organizations(code,name)
        VALUES('legacy_plan_org','Legacy Plan Org') RETURNING id`)).rows[0];
      const other = (await pool.query(`INSERT INTO qarzhy.organizations(code,name)
        VALUES('legacy_plan_other','Other Plan Org') RETURNING id`)).rows[0];
      const user = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,organization_id,password_salt,password_hash)
        VALUES('legacyplanfinance','Legacy Plan Finance',
          (SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2,$3) RETURNING id`,
      [org.id, '0'.repeat(32), '0'.repeat(128)])).rows[0];
      const principal = { id: user.id, name: 'Legacy Plan Finance', organization_id: org.id,
        permissions: ['finance.write'] };
      const input = { date: '2026-10-15', org: 'Legacy Plan Org', article: 'New plan article',
        direction: 'out', amount: 123 };
      const first = await withTransaction(pool, client => planning.saveLegacyPlan({ client, principal, input }));
      const second = await withTransaction(pool, client => planning.saveLegacyPlan({ client, principal,
        input: { ...input, amount: 456, date: '2026-10-16' } }));
      assert.equal(first.organization_id, org.id);
      assert.equal(first.article_id, second.article_id);
      assert.equal(first.amount, '123.00');
      assert.equal(second.amount, '456.00');
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM qarzhy.financial_articles
        WHERE name='New plan article'`)).rows[0].n, 1);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM qarzhy.financial_events
        WHERE organization_id=$1`, [org.id])).rows[0].n, 0);
      await assert.rejects(withTransaction(pool, client => planning.saveLegacyPlan({ client, principal,
        input: { ...input, org: 'Other Plan Org' } })), /forbidden/i);
      await assert.rejects(withTransaction(pool, client => planning.saveLegacyPlan({ client, principal,
        input: { ...input, amount: 1.5 } })), /amount/i);
      await pool.query(`INSERT INTO qarzhy.accounting_periods(organization_id,starts_on,closed)
        VALUES($1,'2026-10-01',true)`, [org.id]);
      await assert.rejects(withTransaction(pool, client => planning.saveLegacyPlan({ client, principal,
        input: { ...input, article: 'Closed plan article' } })), /closed period/i);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM qarzhy.financial_articles
        WHERE name='Closed plan article'`)).rows[0].n, 0);
      assert.notEqual(org.id, other.id);
    } finally { await pool.end(); }
  });
