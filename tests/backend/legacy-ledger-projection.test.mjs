import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { classifyLegacyOperation, buildLegacyLedgerData } from '../../backend/reports/legacy-ledger.mjs';

test('legacy operation kinds are recovered from facts, not article labels', () => {
  assert.equal(classifyLegacyOperation({ eventKind: 'revenue' }), 'sale');
  assert.equal(classifyLegacyOperation({ eventKind: 'loan_repayment', cashDirection: 'out' }), 'loan_payment');
  assert.equal(classifyLegacyOperation({ cashDirection: 'in', settlementKinds: ['sale'] }), 'receipt');
  assert.equal(classifyLegacyOperation({ cashDirection: 'out', settlementKinds: ['purchase'] }), 'supplier_payment');
  assert.equal(classifyLegacyOperation({ cashDirection: 'out', articleEventKinds: ['opex'] }), 'expense_payment');
  assert.equal(classifyLegacyOperation({ cashDirection: 'out', articleEventKinds: ['tax'] }), 'tax_payment');
  assert.equal(classifyLegacyOperation({ cashDirection: 'out', articleName: 'Салық төлемі' }), 'tax_payment');
  assert.throws(() => classifyLegacyOperation({ cashDirection: 'out', articleEventKinds: ['opex', 'tax'] }), /ambiguous/i);
  assert.throws(() => classifyLegacyOperation({ cashDirection: 'out' }), /unclassified/i);
});

test('PostgreSQL ledger projection groups imported facts and balances tax payments',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
    try {
      const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('ledger_projection_org','Ledger Projection Org') RETURNING id")).rows[0];
      const scope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [org.id])).rows[0];
      const dataset = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='legacy_ledger'")).rows[0];
      const article = (await pool.query("INSERT INTO qarzhy.financial_articles(code,name) VALUES('ledger_tax_payment','Салық төлемі') RETURNING id")).rows[0];
      const batchId = await importBatch(pool);
      await pool.query(`INSERT INTO qarzhy.financial_events(dataset_id,scope_id,organization_id,occurred_on,event_kind,
        amount,posting_key,external_key,import_batch_id) VALUES
        ($1,$2,$3,'2032-01-03','revenue',100,'sqlite/operation/91001/event','sqlite/operation/91001/event',$4),
        ($1,$2,$3,'2032-01-04','tax',10,'sqlite/operation/91002/event','sqlite/operation/91002/event',$4)`,
      [dataset.id, scope.id, org.id, batchId]);
      await pool.query(`INSERT INTO qarzhy.cash_movements(dataset_id,scope_id,organization_id,occurred_on,direction,
        amount,article_id,note,posting_key,external_key,import_batch_id) VALUES
        ($1,$2,$3,'2032-01-05','out',10,$4,$5,'sqlite/operation/91003/cash','sqlite/operation/91003/cash',$6)`,
      [dataset.id, scope.id, org.id, article.id, JSON.stringify({ source: 'demo', document: 'TAX-1' }), batchId]);
      const data = await buildLegacyLedgerData({ pool,
        principal: { id: '1', name: 'Finance', username: 'finance', role: 'finance',
          language: 'ru', active: true, password_change_due: false,
          organization_id: org.id, permissions: ['finance.read'] },
        filters: { month: '2032-01' } });
      assert.deepEqual(data.operations.map(row => row.kind), ['sale', 'tax', 'tax_payment']);
      assert.equal(data.operations[2].document, 'TAX-1');
      assert.equal(data.report.revenue, 100);
      assert.equal(data.report.tax, 10);
      assert.equal(data.report.cash, -10);
      assert.equal(data.balance.difference, 0);
      assert.deepEqual(data.orgs, ['Ledger Projection Org']);
      assert.deepEqual(data.audit, []);
      await assert.rejects(buildLegacyLedgerData({ pool,
        principal: { id: '1', role: 'finance', organization_id: org.id, permissions: ['finance.read'] },
        filters: { org: 'Other Organization', month: '2032-01' } }), /organization not available/i);
    } finally { await pool.end(); }
  });

async function importBatch(pool) {
  const existing = (await pool.query("SELECT id FROM qarzhy.import_batches WHERE fingerprint='ledger_projection_test' LIMIT 1")).rows[0];
  if (existing) return existing.id;
  return (await pool.query("INSERT INTO qarzhy.import_batches(fingerprint,finished_at,status) VALUES('ledger_projection_test',now(),'completed') RETURNING id")).rows[0].id;
}
